import { createHash, randomUUID } from "node:crypto";
import type { HookEvent } from "eve/hooks";
import { query } from "@db/queries";
import { claimSession } from "@db/services/sessions";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import {
  readCreatorDraft,
  saveCreatorDraft,
} from "../../server/creators/drafts";
import {
  listCreatorSources,
  readCreatorSource,
} from "../../server/creators/sources";
import {
  captureCreatorUpload,
  readCreatorIntake,
  startCreatorIntake,
} from "../../server/creators/sources/intakes";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

async function intakeFixture(
  actor: Awaited<ReturnType<typeof workspaceFixture>>["personal"]
) {
  const draft = await saveCreatorDraft(actor, {
    id: randomUUID(),
    expectedRevision: null,
    content: {
      title: "Synthetic upload proof",
      description: "",
      playbook: "",
      examples: [],
    },
  });
  const sessionId = randomUUID();
  await claimSession(actor, sessionId);
  const request = {
    id: randomUUID(),
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    title: "Uploaded method",
  };
  const intake = await startCreatorIntake(actor, sessionId, "turn_0", request);
  const content = "  # Method\r\nPreserve café and whitespace.\n\n";
  const event: HookEvent<"message.received"> = {
    type: "message.received",
    meta: {
      id: randomUUID(),
      at: new Date(intake.createdAt + 1000).toISOString(),
    },
    data: {
      turnId: "turn_1",
      sequence: 1,
      message: "Use this source.",
      parts: [
        {
          type: "file",
          filename: "method.md",
          mediaType: "text/markdown",
          url: `data:text/markdown;base64,${Buffer.from(content).toString("base64")}`,
        },
      ],
    },
  };
  return { draft, sessionId, request, intake, content, event };
}

test("one human upload is frozen exactly once, private, unreviewed and absent from teaching", async () => {
  await using workspace = await workspaceFixture();
  const actor = workspace.personal;
  const proof = await intakeFixture(actor);
  expect(
    await startCreatorIntake(actor, proof.sessionId, "turn_0", proof.request)
  ).toEqual(proof.intake);
  await expect(
    startCreatorIntake(actor, proof.sessionId, "turn_1", {
      ...proof.request,
      id: randomUUID(),
    })
  ).rejects.toThrow("already an upload");
  for (const other of [
    workspace.actor,
    workspace.guestPersonal,
    { ...actor, authSessionId: undefined },
  ]) {
    await expect(
      captureCreatorUpload(other, proof.sessionId, proof.event)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(
      readCreatorIntake(other, proof.sessionId, proof.intake.id)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }
  expect(
    await captureCreatorUpload(actor, proof.sessionId, {
      ...proof.event,
      data: { ...proof.event.data, turnId: "turn_0" },
    })
  ).toBeNull();
  expect(
    await captureCreatorUpload(actor, proof.sessionId, {
      ...proof.event,
      meta: {
        ...proof.event.meta,
        at: new Date(proof.intake.createdAt - 1).toISOString(),
      },
    })
  ).toBeNull();
  const results = await Promise.all([
    captureCreatorUpload(actor, proof.sessionId, proof.event),
    captureCreatorUpload(actor, proof.sessionId, proof.event),
  ]);
  expect(results.filter(Boolean)).toEqual([
    { status: "acquired", sourceId: proof.intake.id },
  ]);
  const source = await readCreatorSource(actor, proof.intake.id);
  expect(source.snapshot).toMatchObject({
    extraction: "chat-upload",
    content: proof.content,
    digest: createHash("sha256").update(proof.content).digest("hex"),
    sessionId: proof.sessionId,
    eventId: proof.event.meta.id,
  });
  expect(source.status).toBe("acquired");
  expect(source.rights).toBeNull();
  expect(
    (await readCreatorDraft(actor, proof.draft.id)).content.examples
  ).toEqual([]);
  expect(await listCreatorSources(actor, proof.draft.id)).toHaveLength(1);
  expect(
    await readCreatorIntake(actor, proof.sessionId, proof.intake.id)
  ).toMatchObject({ status: "acquired", sourceId: source.id });
});

test.each(["cancelled", "expired", "changed", "wrong-session", "revoked"])(
  "pending uploads respect %s without creating sources",
  async (condition) => {
    await using workspace = await workspaceFixture();
    const actor = workspace.personal;
    const proof = await intakeFixture(actor);
    let sessionId = proof.sessionId;
    if (condition === "cancelled")
      await readCreatorIntake(actor, sessionId, proof.intake.id, true);
    if (condition === "expired")
      await query(
        sql`UPDATE creator_source_intakes SET created_at=clock_timestamp()-interval '16 minutes', expires_at=clock_timestamp()-interval '1 minute' WHERE id=${proof.intake.id}`
      );
    if (condition === "changed")
      await saveCreatorDraft(actor, {
        id: proof.draft.id,
        expectedRevision: proof.draft.revision,
        content: { ...proof.draft.content, title: "Changed draft" },
      });
    if (condition === "wrong-session") {
      sessionId = randomUUID();
      await claimSession(actor, sessionId);
    }
    if (condition === "revoked")
      await query(
        sql`DELETE FROM public.session WHERE id=${actor.authSessionId}`
      );
    const result = await captureCreatorUpload(
      actor,
      sessionId,
      proof.event
    ).catch((error: unknown) => {
      if (error instanceof WorkspaceAccessDenied)
        return { status: "unauthorized" };
      throw error;
    });
    expect(result?.status ?? null).toBe(
      condition === "changed"
        ? "rejected"
        : condition === "revoked"
          ? "unauthorized"
          : null
    );
    expect(
      await query(
        sql`SELECT id FROM creator_sources WHERE draft_id=${proof.draft.id}`
      )
    ).toEqual([]);
  }
);

test.each([
  {
    filename: "source.pdf",
    mediaType: "application/pdf",
    bytes: Buffer.from("Text"),
  },
  {
    filename: "source.md",
    mediaType: "text/markdown",
    bytes: Buffer.from([0xff, 0xfe]),
  },
  {
    filename: "source.md",
    mediaType: "text/markdown",
    bytes: Buffer.from("\0binary"),
  },
  {
    filename: "source.md",
    mediaType: "text/markdown",
    bytes: Buffer.from("x".repeat(24001)),
  },
  {
    filename: "source.md",
    mediaType: "text/markdown",
    url: "https://example.invalid/source.md",
  },
])(
  "rejects invalid upload $filename without guessing or truncating",
  async (file) => {
    await using workspace = await workspaceFixture();
    const proof = await intakeFixture(workspace.personal);
    const part = {
      type: "file" as const,
      filename: file.filename,
      mediaType: file.mediaType,
      url:
        file.url ??
        `data:${file.mediaType};base64,${file.bytes.toString("base64")}`,
    };
    proof.event.data.parts = [part];
    expect(
      await captureCreatorUpload(
        workspace.personal,
        proof.sessionId,
        proof.event
      )
    ).toMatchObject({ status: "rejected" });
    expect(
      await listCreatorSources(workspace.personal, proof.draft.id)
    ).toEqual([]);
    expect(
      await readCreatorIntake(
        workspace.personal,
        proof.sessionId,
        proof.intake.id
      )
    ).toMatchObject({ status: "rejected" });
  }
);

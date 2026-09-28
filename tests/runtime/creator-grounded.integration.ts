import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { inputRequestSchema } from "eve/client";
import { freePort } from "../helpers/ports";
import {
  compileEveFixture,
  clearFixtureWorkflows,
  runtime,
} from "./eve-fixture";
import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";
import { reviewedCreatorVersion } from "../helpers/creator-release";
import { saveCreatorDraft } from "../../server/creators/drafts";
import { approveCreatorRelease } from "../../server/creators/releases";
import { buildCreatorCorpus } from "../../server/creators/corpus/index";
import { saveCreatorEvaluation } from "../../server/creators/evaluation";
import {
  createCreatorPreview,
  exportCreatorPreview,
  claimCreatorPreview,
  finishCreatorPreview,
} from "../../server/creators/previews";
import { readCreatorReleaseCandidate } from "../../server/creators/release-candidate";
const { archive } = await vi.hoisted(async () => {
  const { mkdtemp: makeDirectory } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const paths = await import("node:path");
  const temporary = await makeDirectory(paths.join(tmpdir(), "zoen-grounded-"));
  process.env.ZOEN_SESSION_ARCHIVE_DIR = temporary;
  return { archive: temporary };
});
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: { ...actual.env, ZOEN_SESSION_ARCHIVE_DIR: archive },
  };
});
let directory: string;
beforeAll(async () => {
  await clearFixtureWorkflows();
  const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
  directory = await mkdtemp(join(fixtures, ".eve-grounded-"));
  for (const name of ["agent", "package.json", "tsconfig.json"])
    await cp(join(fixtures, "eve-runtime", name), join(directory, name), {
      recursive: true,
    });
  for (const name of ["creator-preview", "creator-library", "creator-review"]) {
    const text = await readFile(
      new URL(`../../agent/tools/${name}.ts`, import.meta.url),
      "utf8"
    );
    await writeFile(
      join(directory, `agent/tools/${name}.ts`),
      text.replaceAll('"../../server/', '"../../../../../server/')
    );
  }
  await cp(
    new URL(
      "../../agent/subagents/creator-specialist/instructions.md",
      import.meta.url
    ),
    join(directory, "agent/subagents/creator-specialist/instructions.md")
  );
  await compileEveFixture(directory);
}, 90000);
afterAll(async () => {
  await clearFixtureWorkflows();
  if (directory) await rm(directory, { recursive: true, force: true });
  await rm(archive, { recursive: true, force: true });
});

async function approved(actor: Parameters<typeof saveCreatorDraft>[0]) {
  const draft = await saveCreatorDraft(actor, {
    id: randomUUID(),
    expectedRevision: null,
    content: {
      title: "Grounded fixture",
      description: "Synthetic",
      playbook: "Be concise; abstain without evidence.",
      examples: [
        {
          id: randomUUID(),
          title: "Cerulean rule",
          content: "Cerulean harvest happens every forty days.",
          source: "Original fictional source",
          rights: "original",
        },
      ],
    },
  });
  const reviewed = await reviewedCreatorVersion(actor, draft);
  const release = await approveCreatorRelease(actor, reviewed.input);
  await buildCreatorCorpus(actor, release.id);
  const saved = await saveCreatorEvaluation(actor, {
    draftId: draft.id,
    expectedRevision: reviewed.input.evaluationRevision,
    cases: [
      {
        id: randomUUID(),
        title: "Grounded question",
        question: "When is the Cerulean harvest?",
        criteria:
          "Cite the fictional forty-day interval; no unsupported claims.",
      },
    ],
  });
  if (!saved.evaluation) throw new Error("Expected evaluation");
  const item = saved.evaluation.cases[0];
  if (!item) throw new Error("Expected case");
  const request = {
    id: randomUUID(),
    draftId: draft.id,
    revision: draft.revision,
    kind: "grounded-answer" as const,
    releaseId: release.id,
    question: item.question,
    caseRef: { id: item.id, revision: saved.evaluation.revision },
  };
  return { request, release };
}

test("real Akita evidence reaches isolated structured specialist and human review survives restart without qualifying snapshot release", async () => {
  await using workspace = await workspaceFixture();
  const { request } = await approved(workspace.personal);
  const preview = await createCreatorPreview(workspace.personal, request);
  expect(preview.answerMode).toBe("grounded");
  expect(preview.grounding?.citations[0]?.excerpt).toContain("forty days");
  const server = await runtime(await freePort(), "127.0.0.1", directory);
  const auth = workspaceExecutionFor(workspace.personal).session.auth.current;
  const { sessionId } = z.object({ sessionId: z.string() }).parse(
    await server.request("/probe/send", {
      address: randomUUID(),
      id: randomUUID(),
      message: "ROOT-PRIVATE-CONTEXT-MUST-NOT-CROSS",
      auth,
    })
  );
  await server.settled(sessionId);
  await server.request(`/probe/message/${sessionId}`, {
    message: `preview ${preview.id}`,
    auth,
  });
  const events = await server.settled(sessionId, 2);
  const result = await exportCreatorPreview(workspace.personal, preview.id);
  expect(result.status).toBe("completed");
  expect(result.groundedAnswer).toMatchObject({
    status: "supported",
    citations: ["S1"],
  });
  expect(result.models).toHaveLength(1);
  const child = z
    .object({ childSessionId: z.string() })
    .parse(events.find((event) => event.type === "subagent.called")?.data);
  const childEvents = JSON.stringify(
    await server.request(`/probe/events/${child.childSessionId}`)
  );
  expect(childEvents).toContain("forty days");
  expect(childEvents).not.toContain("ROOT-PRIVATE-CONTEXT-MUST-NOT-CROSS");
  expect(childEvents).not.toContain("Cite the fictional forty-day interval");
  await server.request(`/probe/message/${sessionId}`, {
    message: `creator-review ${preview.id}`,
    auth,
  });
  const waiting = await server.settled(sessionId, 3);
  const verdict = z
    .object({ requests: z.array(inputRequestSchema) })
    .parse(waiting.findLast((event) => event.type === "input.requested")?.data)
    .requests[0];
  if (!verdict) throw new Error("Expected human review");
  expect(JSON.stringify(verdict)).toContain("forty days");
  await server.stop();
  const resumed = await runtime(await freePort(), "127.0.0.1", directory);
  await resumed.request(`/probe/input/${sessionId}`, {
    auth,
    responses: [{ requestId: verdict.requestId, optionId: "useful" }],
  });
  const notesEvents = await resumed.settled(sessionId, 4);
  const notes = z
    .object({ requests: z.array(inputRequestSchema) })
    .parse(
      notesEvents.findLast((event) => event.type === "input.requested")?.data
    ).requests[0];
  if (!notes) throw new Error("Expected notes");
  await resumed.request(`/probe/input/${sessionId}`, {
    auth,
    responses: [
      {
        requestId: notes.requestId,
        text: "Human verified exact source support.",
      },
    ],
  });
  await resumed.settled(sessionId, 5);
  const final = await exportCreatorPreview(workspace.personal, preview.id);
  expect(final.review?.content.verdict).toBe("useful");
  expect(final.grounding).toEqual(preview.grounding);
  expect(
    (await readCreatorReleaseCandidate(workspace.personal, request.draftId))
      .issues.length
  ).toBeGreaterThan(0);
  await resumed.stop();
}, 90000);

test("grounded requests reject foreign access and citations outside frozen evidence", async () => {
  await using workspace = await workspaceFixture();
  const { request } = await approved(workspace.personal);
  await expect(createCreatorPreview(workspace.guest, request)).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
  const preview = await createCreatorPreview(workspace.personal, request);
  await claimCreatorPreview(workspace.personal, preview.id, "citation-worker", {
    sessionId: randomUUID(),
    turnId: "t0",
  });
  await finishCreatorPreview(
    workspace.personal,
    preview.id,
    "citation-worker",
    { status: "supported", answer: "Invented", citations: ["S8"] }
  );
  expect(
    await exportCreatorPreview(workspace.personal, preview.id)
  ).toMatchObject({ status: "failed", response: null, groundedAnswer: null });
}, 90000);

test("no-match packages cannot claim support and revoked owners cannot execute frozen evidence", async () => {
  await using workspace = await workspaceFixture();
  const { request } = await approved(workspace.personal);
  const saved = await saveCreatorEvaluation(workspace.personal, {
    draftId: request.draftId,
    expectedRevision: request.caseRef.revision,
    cases: [
      {
        id: randomUUID(),
        title: "No evidence",
        question: "Zyxnonexistentcanary?",
        criteria: "Abstain without evidence.",
      },
    ],
  });
  if (!saved.evaluation?.cases[0]) throw new Error("Expected no-evidence case");
  const item = saved.evaluation.cases[0];
  const preview = await createCreatorPreview(workspace.personal, {
    ...request,
    id: randomUUID(),
    question: item.question,
    caseRef: { id: item.id, revision: saved.evaluation.revision },
  });
  expect(preview.grounding?.citations).toEqual([]);
  await claimCreatorPreview(workspace.personal, preview.id, "empty-worker", {
    sessionId: randomUUID(),
    turnId: "t0",
  });
  await finishCreatorPreview(workspace.personal, preview.id, "empty-worker", {
    status: "supported",
    answer: "Invented answer",
    citations: [],
  });
  expect(
    await exportCreatorPreview(workspace.personal, preview.id)
  ).toMatchObject({ status: "failed", response: null });
  const abstention = await createCreatorPreview(workspace.personal, {
    ...request,
    id: randomUUID(),
    question: item.question,
    caseRef: { id: item.id, revision: saved.evaluation.revision },
  });
  await claimCreatorPreview(
    workspace.personal,
    abstention.id,
    "abstention-worker",
    { sessionId: randomUUID(), turnId: "t0" }
  );
  await finishCreatorPreview(
    workspace.personal,
    abstention.id,
    "abstention-worker",
    {
      status: "insufficient-evidence",
      answer: "No evidence found.",
      citations: [],
    }
  );
  expect(
    (await exportCreatorPreview(workspace.personal, abstention.id))
      .groundedAnswer?.status
  ).toBe("insufficient-evidence");
  const next = await createCreatorPreview(workspace.personal, {
    ...request,
    id: randomUUID(),
    question: item.question,
    caseRef: { id: item.id, revision: saved.evaluation.revision },
  });
  await query(
    sql`DELETE FROM public.session WHERE id=${workspace.personal.authSessionId}`
  );
  await expect(
    claimCreatorPreview(workspace.personal, next.id, "revoked-worker", {
      sessionId: randomUUID(),
      turnId: "t0",
    })
  ).rejects.toThrow("WorkspaceAccessDenied");
}, 90000);

test("invented citations from the actual specialist workflow finish failed without saving model prose", async () => {
  await using workspace = await workspaceFixture();
  const { request } = await approved(workspace.personal);
  const updated = await saveCreatorEvaluation(workspace.personal, {
    draftId: request.draftId,
    expectedRevision: request.caseRef.revision,
    cases: [
      {
        id: randomUUID(),
        title: "Citation boundary",
        question: "Cerulean synthetic-forged-citation?",
        criteria: "Reject invented references.",
      },
    ],
  });
  if (!updated.evaluation?.cases[0]) throw new Error("Expected case");
  const item = updated.evaluation.cases[0];
  const preview = await createCreatorPreview(workspace.personal, {
    ...request,
    question: item.question,
    caseRef: { id: item.id, revision: updated.evaluation.revision },
  });
  const server = await runtime(await freePort(), "127.0.0.1", directory);
  const auth = workspaceExecutionFor(workspace.personal).session.auth.current;
  const { sessionId } = z.object({ sessionId: z.string() }).parse(
    await server.request("/probe/send", {
      address: randomUUID(),
      id: randomUUID(),
      message: `preview ${preview.id}`,
      auth,
    })
  );
  await server.settled(sessionId);
  expect(
    await exportCreatorPreview(workspace.personal, preview.id)
  ).toMatchObject({ status: "failed", response: null, groundedAnswer: null });
  await server.stop();
}, 90000);

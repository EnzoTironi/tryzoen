import { reviewedCreatorVersion } from "../helpers/creator-release";
import { approveCreatorRelease } from "../../server/creators/releases";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import {
  actOnCreatorPilot,
  inviteCreatorPilot,
} from "../../server/creators/pilots";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { freePort } from "../helpers/ports";
import {
  compileEveFixture,
  clearFixtureWorkflows,
  runtime,
} from "./eve-fixture";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";
import { saveCreatorEvaluation } from "../../server/creators/evaluation";
import { saveCreatorDraft } from "../../server/creators/drafts";
import {
  exportCreatorPreview,
  createCreatorPreview,
  listCreatorPreviews,
} from "../../server/creators/previews";

let directory: string;
beforeAll(async () => {
  await clearFixtureWorkflows();
  const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
  directory = await mkdtemp(join(fixtures, ".eve-creator-preview-"));
  for (const name of ["agent", "package.json", "tsconfig.json"])
    await cp(join(fixtures, "eve-runtime", name), join(directory, name), {
      recursive: true,
    });
  // Workflow tools must be compiled as authored modules, not re-exported definitions.
  const tool = await readFile(
    new URL("../../agent/tools/creator-preview.ts", import.meta.url),
    "utf8"
  );
  await writeFile(
    join(directory, "agent/tools/creator-preview.ts"),
    tool.replaceAll('"../../server/', '"../../../../../server/')
  );
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
});

test.each(["answer", "playbook"] as const)(
  "native Eve %s workflow runs only authorized sources in a tool-free child, excluding root history and memory",
  async (kind) => {
    await using workspace = await workspaceFixture();
    const draft = await saveCreatorDraft(workspace.personal, {
      id: randomUUID(),
      expectedRevision: null,
      content: {
        title: "Synthetic specialist",
        description: "Test",
        playbook: "SYNTHETIC-PLAYBOOK-ONLY",
        examples: [
          {
            id: randomUUID(),
            title: "SYNTHETIC-AUTHORED-EXAMPLE",
            content:
              "Ask an open question when a fictional reading group is quiet.",
            source: "Original fictional example",
            rights: "original",
          },
        ],
      },
    });
    const caseId = randomUUID();
    const saved = await saveCreatorEvaluation(workspace.personal, {
      draftId: draft.id,
      expectedRevision: null,
      cases: [
        {
          id: caseId,
          title: "Selected case",
          question: "SYNTHETIC-QUESTION-ONLY",
          criteria: "HIDDEN-EVALUATION-RUBRIC-MUST-NOT-CROSS",
        },
        {
          id: randomUUID(),
          title: "Other case",
          question: "OTHER-HELD-OUT-QUESTION-MUST-NOT-CROSS",
          criteria: "Other criteria",
        },
      ],
    });
    if (!saved.evaluation) throw new Error("Expected saved cases");
    const preview = await createCreatorPreview(workspace.personal, {
      id: randomUUID(),
      draftId: draft.id,
      revision: draft.revision,
      kind,
      question: "SYNTHETIC-QUESTION-ONLY",
      ...(kind === "answer"
        ? { caseRef: { id: caseId, revision: saved.evaluation.revision } }
        : {}),
    });
    const server = await runtime(await freePort(), "127.0.0.1", directory);
    const principal = workspaceExecutionFor(workspace.personal).session.auth
      .current;
    const auth = {
      ...principal,
      attributes: { ...principal.attributes, memoryProof: "enabled" },
    };
    const { sessionId } = z.object({ sessionId: z.string() }).parse(
      await server.request("/probe/send", {
        address: randomUUID(),
        id: randomUUID(),
        message: "remember",
        auth,
      })
    );
    const remembered = await server.settled(sessionId);
    expect(
      JSON.stringify(
        remembered.findLast((event) => event.type === "message.completed")
      )
    ).toContain("Synthetic favorite color: orange");
    await server.request(`/probe/message/${sessionId}`, {
      message: "ROOT-PRIVATE-CONTEXT-MUST-NOT-CROSS",
      auth,
    });
    const parent = await server.settled(sessionId, 2);
    expect(
      JSON.stringify(
        parent.findLast((event) => event.type === "message.completed")
      )
    ).not.toContain("creator-specialist");
    await server.request(`/probe/message/${sessionId}`, {
      message: `preview ${preview.id}`,
      auth,
    });
    const events = await server.settled(sessionId, 3);
    const [result] = await listCreatorPreviews(workspace.personal, draft.id);
    if (!result) throw new Error("Expected the saved preview");
    const child = z
      .object({ childSessionId: z.string() })
      .parse(events.find((event) => event.type === "subagent.called")?.data);
    const childEvents = await server.request(
      `/probe/events/${child.childSessionId}`
    );
    expect(result.status, JSON.stringify(childEvents)).toBe("completed");
    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.modelId).toBeTruthy();
    expect(result.models[0]?.provider).toBeTruthy();
    expect(result.startedAt).toBeGreaterThanOrEqual(preview.createdAt);
    expect(result.finishedAt).toBeGreaterThanOrEqual(
      result.startedAt ?? Infinity
    );
    const receipt = z
      .object({ tools: z.array(z.string()), messages: z.unknown() })
      .parse(JSON.parse(result.response ?? "null"));
    // Markdown is the result itself; no result formatter or action tools are exposed.
    expect(receipt.tools).toEqual([]);
    const context = JSON.stringify(receipt.messages);
    expect(context.includes("SYNTHETIC-PLAYBOOK-ONLY")).toBe(kind === "answer");
    expect(context).toContain("SYNTHETIC-AUTHORED-EXAMPLE");
    expect(context).toContain("SYNTHETIC-QUESTION-ONLY");
    expect(context).not.toContain("ROOT-PRIVATE-CONTEXT-MUST-NOT-CROSS");
    expect(context).not.toContain("HIDDEN-EVALUATION-RUBRIC-MUST-NOT-CROSS");
    expect(context).not.toContain("OTHER-HELD-OUT-QUESTION-MUST-NOT-CROSS");
    expect(result.evaluation?.case.criteria).toBe(
      kind === "answer" ? "HIDDEN-EVALUATION-RUBRIC-MUST-NOT-CROSS" : undefined
    );
    expect(context).not.toContain("personal_info");
    expect(context).not.toContain("Synthetic favorite color: orange");
    await server.stop();
  },
  90000
);

test.each([
  "synthetic-provider-failure",
  "synthetic-blank-answer",
  "synthetic-oversized-answer",
])(
  "native child %s persists a failed preview without an invalid answer",
  async (question) => {
    await using workspace = await workspaceFixture();
    const draft = await saveCreatorDraft(workspace.personal, {
      id: randomUUID(),
      expectedRevision: null,
      content: {
        title: "Synthetic failed preview",
        description: "Test",
        playbook: "Test only",
        examples: [],
      },
    });
    const preview = await createCreatorPreview(workspace.personal, {
      id: randomUUID(),
      draftId: draft.id,
      revision: draft.revision,
      kind: "answer" as const,
      question,
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
      (await listCreatorPreviews(workspace.personal, draft.id))[0]
    ).toMatchObject({ status: "failed", response: null });
    await server.stop();
  },
  90000
);

test("an accepted pilot runs the creator's approved teaching as the participant's isolated Eve child", async () => {
  await using workspace = await workspaceFixture();
  const source = await reviewedCreatorVersion(workspace.actor);
  const release = await approveCreatorRelease(workspace.actor, source.input);
  const username = `pilot_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  await saveDirectoryProfile(workspace.guest, {
    username,
    discoverable: false,
  });
  const pilot = await inviteCreatorPilot(workspace.actor, {
    id: randomUUID(),
    releaseId: release.id,
    username,
    shareTeaching: true,
  });
  await actOnCreatorPilot(workspace.guest, { id: pilot.id, action: "accept" });
  const preview = await createCreatorPreview(workspace.guest, {
    id: randomUUID(),
    draftId: release.draftId,
    revision: release.revision,
    pilotId: pilot.id,
    kind: "answer",
    question: "SYNTHETIC-PARTICIPANT-QUESTION",
  });
  const server = await runtime(await freePort(), "127.0.0.1", directory);
  try {
    const auth = workspaceExecutionFor(workspace.guest).session.auth.current;
    const { sessionId } = z.object({ sessionId: z.string() }).parse(
      await server.request("/probe/send", {
        address: randomUUID(),
        id: randomUUID(),
        message: "PARTICIPANT-ROOT-HISTORY-MUST-NOT-CROSS",
        auth,
      })
    );
    await server.settled(sessionId);
    await server.request(`/probe/message/${sessionId}`, {
      message: `preview ${preview.id}`,
      auth,
    });
    await server.settled(sessionId, 2);
    const [result] = await listCreatorPreviews(
      workspace.guest,
      release.draftId,
      pilot.id
    );
    expect(result?.status).toBe("completed");
    const receipt = z
      .object({ tools: z.array(z.string()), messages: z.unknown() })
      .parse(JSON.parse(result?.response ?? "null"));
    expect(receipt.tools).toEqual([]);
    const context = JSON.stringify(receipt.messages);
    expect(context).toContain(release.content.playbook);
    expect(context).toContain("SYNTHETIC-PARTICIPANT-QUESTION");
    expect(context).not.toContain("PARTICIPANT-ROOT-HISTORY-MUST-NOT-CROSS");
    expect(context).not.toContain(source.input.notes);
    expect(context).not.toContain(source.draft.evaluation?.cases[0]?.criteria);
    expect(result?.models).toHaveLength(1);
    await expect(
      exportCreatorPreview(workspace.actor, preview.id)
    ).rejects.toThrow("WorkspaceAccessDenied");
  } finally {
    await server.stop();
  }
}, 90000);

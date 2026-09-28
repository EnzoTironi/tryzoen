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
import { saveCreatorDraft } from "../../server/creators/drafts";
import {
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
  await compileEveFixture(directory);
}, 90000);
afterAll(async () => {
  await clearFixtureWorkflows();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("native Eve workflow runs only the authorized snapshot in a tool-free child, excluding root history and memory", async () => {
  await using workspace = await workspaceFixture();
  const draft = await saveCreatorDraft(workspace.personal, {
    id: randomUUID(),
    expectedRevision: null,
    content: {
      title: "Synthetic specialist",
      description: "Test",
      playbook: "SYNTHETIC-PLAYBOOK-ONLY",
      examples: [],
    },
  });
  const preview = await createCreatorPreview(workspace.personal, {
    id: randomUUID(),
    draftId: draft.id,
    revision: draft.revision,
    question: "SYNTHETIC-QUESTION-ONLY",
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
  const receipt = z
    .object({ tools: z.array(z.string()), messages: z.unknown() })
    .parse(JSON.parse(result.response ?? "null"));
  // Eve's result formatter is the sole tool; there are no filesystem, network,
  // memory, connection, delegation or application capabilities in this child.
  expect(receipt.tools).toEqual(["final_output"]);
  const context = JSON.stringify(receipt.messages);
  expect(context).toContain("SYNTHETIC-PLAYBOOK-ONLY");
  expect(context).toContain("SYNTHETIC-QUESTION-ONLY");
  expect(context).not.toContain("ROOT-PRIVATE-CONTEXT-MUST-NOT-CROSS");
  expect(context).not.toContain("personal_info");
  expect(context).not.toContain("Synthetic favorite color: orange");
  await server.stop();
}, 90000);

test("native child provider failure persists a failed preview instead of a fabricated answer", async () => {
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
    question: "synthetic-provider-failure",
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
}, 90000);

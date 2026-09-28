import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { inputRequestSchema } from "eve/client";
import { z } from "zod";
import { freePort } from "../helpers/ports";
import {
  compileEveFixture,
  clearFixtureWorkflows,
  runtime,
} from "./eve-fixture";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";
import {
  readCreatorDraft,
  saveCreatorDraft,
} from "../../server/creators/drafts";

let directory: string;
beforeAll(async () => {
  await clearFixtureWorkflows();
  const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
  directory = await mkdtemp(join(fixtures, ".eve-creator-interview-"));
  for (const name of ["agent", "package.json", "tsconfig.json"])
    await cp(join(fixtures, "eve-runtime", name), join(directory, name), {
      recursive: true,
    });
  const source = await readFile(
    new URL("../../agent/tools/creator-interview.ts", import.meta.url),
    "utf8"
  );
  await writeFile(
    join(directory, "agent/tools/creator-interview.ts"),
    source.replaceAll('"../../server/', '"../../../../../server/')
  );
  await compileEveFixture(directory);
}, 90000);
afterAll(async () => {
  await clearFixtureWorkflows();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function start(actor: Parameters<typeof workspaceExecutionFor>[0]) {
  const draft = await saveCreatorDraft(actor, {
    id: randomUUID(),
    expectedRevision: null,
    content: {
      title: "Synthetic interview guide",
      description: "Private starting material",
      playbook: "# Existing guidance\n\nPreserve this authored paragraph.",
      examples: [],
    },
  });
  const server = await runtime(await freePort(), "127.0.0.1", directory);
  const auth = workspaceExecutionFor(actor).session.auth.current;
  const { sessionId } = z.object({ sessionId: z.string() }).parse(
    await server.request("/probe/send", {
      address: randomUUID(),
      id: randomUUID(),
      auth,
      message: `creator-interview ${JSON.stringify({ id: draft.id, expectedRevision: draft.revision })}`,
    })
  );
  const events = await server.settled(sessionId);
  return { server, auth, draft, sessionId, events, count: 1 };
}
function question(state: Awaited<ReturnType<typeof start>>) {
  const item = z
    .object({ requests: z.array(inputRequestSchema) })
    .parse(
      state.events.findLast((event) => event.type === "input.requested")?.data
    ).requests[0];
  if (!item) throw new Error("Expected a durable interview question");
  return item;
}
async function answer(
  state: Awaited<ReturnType<typeof start>>,
  response: { optionId?: string; text?: string }
) {
  await state.server.request(`/probe/input/${state.sessionId}`, {
    auth: state.auth,
    responses: [{ requestId: question(state).requestId, ...response }],
  });
  state.events = await state.server.settled(state.sessionId, ++state.count);
}

test("guided interview resumes after restart, permits skip and saves only the exact human-approved addition", async () => {
  await using workspace = await workspaceFixture();
  const state = await start(workspace.personal);
  await answer(state, { text: "Help new readers enjoy a book club." });
  await state.server.stop();
  state.server = await runtime(await freePort(), "127.0.0.1", directory);
  await answer(state, { optionId: "skip" });
  await answer(state, {
    text: "Never invent quotations. Ask for the passage.",
  });
  const proposed = question(state).prompt;
  expect(proposed).toContain(state.draft.content.playbook);
  expect(proposed).toContain("Help new readers enjoy a book club.");
  expect(proposed).not.toContain("### Approach and voice");
  expect(
    (await readCreatorDraft(workspace.personal, state.draft.id)).revision
  ).toBe(state.draft.revision);
  await answer(state, { optionId: "save" });
  const saved = await readCreatorDraft(workspace.personal, state.draft.id);
  expect(proposed.endsWith(saved.content.playbook)).toBe(true);
  expect(saved.content.title).toBe(state.draft.content.title);
  expect(saved.content.examples).toEqual(state.draft.content.examples);
  await expect(
    readCreatorDraft(workspace.guest, state.draft.id)
  ).rejects.toThrow("WorkspaceAccessDenied");
  await state.server.stop();
}, 90000);

test("cancelling the final review leaves all existing guidance unchanged", async () => {
  await using workspace = await workspaceFixture();
  const state = await start(workspace.personal);
  await answer(state, { text: "Unapproved interview answer" });
  await answer(state, { optionId: "skip" });
  await answer(state, { optionId: "skip" });
  await answer(state, { optionId: "cancel" });
  expect(await readCreatorDraft(workspace.personal, state.draft.id)).toEqual(
    state.draft
  );
  await state.server.stop();
}, 60000);

test("a stale interview cannot overwrite guidance edited while the person was answering", async () => {
  await using workspace = await workspaceFixture();
  const state = await start(workspace.personal);
  await answer(state, { text: "Initial idea" });
  await answer(state, { optionId: "skip" });
  await answer(state, { optionId: "skip" });
  const newer = await saveCreatorDraft(workspace.personal, {
    id: state.draft.id,
    expectedRevision: state.draft.revision,
    content: { ...state.draft.content, playbook: "A later human correction." },
  });
  await state.server.request(`/probe/input/${state.sessionId}`, {
    auth: state.auth,
    responses: [{ requestId: question(state).requestId, optionId: "save" }],
  });
  await expect
    .poll(
      async () =>
        JSON.stringify(
          await state.server.request(`/probe/events/${state.sessionId}`)
        ),
      { timeout: 30000 }
    )
    .toContain("This draft changed elsewhere");
  expect(await readCreatorDraft(workspace.personal, state.draft.id)).toEqual(
    newer
  );
  await state.server.stop();
}, 60000);

import { buildEveFixture, clearFixtureWorkflows, runtime } from "./eve-fixture";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { inputRequestSchema } from "eve/client";
import { z } from "zod";
import { afterAll, beforeAll, expect, test } from "vitest";
import { freePort } from "../helpers/ports";
import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";
beforeAll(buildEveFixture, 65_000);
afterAll(clearFixtureWorkflows);
test("compiled Eve tools survive cold delivery races and process restart without repeating writes", async () => {
  await using workspace = await workspaceFixture();
  const auth = workspaceExecutionFor(workspace.actor).session.auth.current;
  const port = await freePort();
  const server = await runtime(port);
  const input = {
    address: randomUUID(),
    id: randomUUID(),
    message: "write",
    auth,
  };
  const responses = await Promise.all(
    Array.from(
      {
        length: 3,
      },
      () => server.request("/probe/send", input)
    )
  );
  const ids = responses.map(
    (response) =>
      z
        .object({
          sessionId: z.string(),
        })
        .parse(response).sessionId
  );
  expect(new Set(ids).size).toBe(1);
  const sessionId = ids[0];
  if (!sessionId) throw new Error("Missing accepted session");
  const events = await server.settled(sessionId);
  expect(
    events.filter((event) => event.type === "message.received")
  ).toHaveLength(1);
  expect(JSON.stringify(events)).toContain("workspace-save");
  expect(
    (await workspace.repository.read(workspace.actor, "knowledge/native.md"))
      .content,
    JSON.stringify(events) + "\n" + server.output()
  ).toBe("Written by native Eve");
  expect(
    await workspace.repository.history(workspace.actor, "knowledge/native.md")
  ).toHaveLength(1);
  await server.stop();
  const resumed = await runtime(port);
  expect(await resumed.request("/probe/send", input)).toEqual({
    sessionId,
  });
  await setTimeout(300);
  const replay = await resumed.settled(sessionId);
  expect(
    replay.filter((event) => event.type === "message.received")
  ).toHaveLength(1);
  expect(
    await workspace.repository.history(workspace.actor, "knowledge/native.md")
  ).toHaveLength(1);
  expect(
    await resumed.request("/probe/send", {
      ...input,
      id: randomUUID(),
      message: "continue",
    })
  ).toEqual({
    sessionId,
  });
  expect(
    (await resumed.settled(sessionId, 2))
      .filter((event) => event.type === "message.received")
      .map(
        (event) =>
          z
            .object({
              message: z.string(),
            })
            .parse(event.data).message
      )
  ).toEqual(["write", "continue"]);
  await resumed.stop();
}, 90_000);
test("native memory tools return updated notes to the model and later turns recall the deletion", async () => {
  await using workspace = await workspaceFixture();
  const principal = workspaceExecutionFor(workspace.personal).session.auth
    .current;
  const auth = {
    ...principal,
    attributes: { ...principal.attributes, memoryProof: "enabled" },
  };
  const server = await runtime(await freePort());
  const address = randomUUID();
  const { sessionId } = z.object({ sessionId: z.string() }).parse(
    await server.request("/probe/send", {
      address,
      id: randomUUID(),
      message: "remember",
      auth,
    })
  );
  const saved = await server.settled(sessionId);
  expect(
    JSON.stringify(saved.filter((event) => event.type === "message.completed"))
  ).toContain("Synthetic favorite color: orange");
  await server.request("/probe/send", {
    address,
    id: randomUUID(),
    message: "forget",
    auth,
  });
  const forgotten = await server.settled(sessionId, 2);
  const result = JSON.stringify(
    forgotten.findLast((event) => event.type === "action.result")
  );
  expect(result).toContain("No memories are saved.");
  expect(result).not.toContain("Synthetic favorite color: orange");
  expect(
    JSON.stringify(
      forgotten.findLast((event) => event.type === "message.completed")
    )
  ).toContain("No memories are saved.");
  await server.request("/probe/send", {
    address,
    id: randomUUID(),
    message: "recall",
    auth,
  });
  const recalled = JSON.stringify(
    (await server.settled(sessionId, 3)).findLast(
      (event) => event.type === "message.completed"
    )
  );
  expect(recalled).toContain("No memories are saved.");
  expect(recalled).not.toContain("Synthetic favorite color: orange");
  await server.stop();
}, 60_000);

test("Eve resumes a pending approval after process restart and executes it once", async () => {
  await using workspace = await workspaceFixture();
  const auth = workspaceExecutionFor(workspace.actor).session.auth.current;
  const port = await freePort();
  const server = await runtime(port);
  const input = {
    address: randomUUID(),
    id: randomUUID(),
    message: "approve",
    auth,
  };
  const { sessionId } = z
    .object({
      sessionId: z.string(),
    })
    .parse(await server.request("/probe/send", input));
  const pending = await server.settled(sessionId);
  const event = pending.find(
    (localEvent) => localEvent.type === "input.requested"
  );
  const request = z
    .object({
      requests: z.array(inputRequestSchema),
    })
    .parse(event?.data).requests[0];
  if (!request) throw new Error("Missing approval request");
  expect(request.kind).toBe("tool-approval");
  expect(
    pending.filter((localEvent) => localEvent.type === "action.result")
  ).toHaveLength(0);
  await server.stop();
  const resumed = await runtime(port);
  await resumed.request(`/probe/respond/${input.address}`, {
    auth,
    responses: [
      {
        requestId: request.requestId,
        optionId: "approve",
      },
    ],
  });
  const approved = await resumed.settled(sessionId, 2);
  expect(
    approved.filter((localEvent) => localEvent.type === "action.result")
  ).toHaveLength(1);
  expect(JSON.stringify(approved)).toContain("Approved content");
  await resumed.stop();
}, 90_000);

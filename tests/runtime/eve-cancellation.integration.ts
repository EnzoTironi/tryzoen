import { randomUUID } from "node:crypto";
import { z } from "zod";
import { afterAll, beforeAll, expect, test } from "vitest";
import { freePort } from "../helpers/ports";
import { buildEveFixture, clearFixtureWorkflows, runtime } from "./eve-fixture";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";

beforeAll(buildEveFixture, 65_000);
afterAll(clearFixtureWorkflows);

test("cancelling a parked session's next streaming turn aborts promptly without replaying writes", async () => {
  await using workspace = await workspaceFixture();
  const auth = workspaceExecutionFor(workspace.actor).session.auth.current;
  const port = await freePort();
  const server = await runtime(port);
  const address = randomUUID();
  const { sessionId } = z.object({ sessionId: z.string() }).parse(
    await server.request("/probe/send", {
      address,
      id: randomUUID(),
      message: "write",
      auth,
    })
  );
  await server.settled(sessionId);
  await server.request("/probe/send", {
    address,
    id: randomUUID(),
    message: "cancel-slow",
    auth,
  });
  const eventsSchema = z.array(
    z.object({ type: z.string(), data: z.unknown() })
  );
  await expect
    .poll(
      async () => {
        const events = eventsSchema.parse(
          await server.request(`/probe/events/${sessionId}`)
        );
        return events.some(
          (event) =>
            event.type === "message.appended" &&
            JSON.stringify(event.data).includes("Slow response started.")
        );
      },
      { timeout: 10_000, interval: 50 }
    )
    .toBe(true);

  const started = performance.now();
  expect(await server.request(`/probe/cancel/${sessionId}`, {})).toEqual({
    sessionId,
    status: "accepted",
  });
  await expect
    .poll(
      async () => {
        const events = eventsSchema.parse(
          await server.request(`/probe/events/${sessionId}`)
        );
        return events.some((event) => event.type === "turn.cancelled");
      },
      { timeout: 5_000, interval: 50 }
    )
    .toBe(true);
  expect(performance.now() - started).toBeLessThan(5_000);
  const cancelled = await server.settled(sessionId, 2);
  expect(JSON.stringify(cancelled)).not.toContain("Late response finished.");
  expect(
    cancelled.filter((event) => event.type === "turn.cancelled")
  ).toHaveLength(1);
  expect(
    cancelled.filter((event) => event.type === "turn.completed")
  ).toHaveLength(1);
  expect(
    await workspace.repository.history(workspace.actor, "knowledge/native.md")
  ).toHaveLength(1);

  await server.stop();
  const resumed = await runtime(port);
  await resumed.request("/probe/send", {
    address,
    id: randomUUID(),
    message: "continue",
    auth,
  });
  const continued = await resumed.settled(sessionId, 3);
  expect(
    continued.filter((event) => event.type === "turn.completed")
  ).toHaveLength(2);
  expect(
    continued.filter((event) => event.type === "action.result")
  ).toHaveLength(1);
  expect(
    await workspace.repository.history(workspace.actor, "knowledge/native.md")
  ).toHaveLength(1);
  await resumed.stop();
}, 60_000);

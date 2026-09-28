import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import { sessionSourceSchema } from "../../server/memory/session-files";
import { freePort } from "../helpers/ports";
import { buildEveFixture, clearFixtureWorkflows, runtime } from "./eve-fixture";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";

const directory = await mkdtemp(join(tmpdir(), "zoen-eve-capture-"));
beforeAll(async () => {
  vi.stubEnv("ZOEN_SESSION_ARCHIVE_DIR", directory);
  await buildEveFixture();
}, 65_000);
afterAll(async () => {
  await clearFixtureWorkflows();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("the compiled Eve runtime archives settled replies across restart and never settles a cancelled response", async () => {
  await using workspace = await workspaceFixture();
  const current = workspaceExecutionFor(workspace.personal).session.auth
    .current;
  const auth = {
    ...current,
    attributes: { ...current.attributes, archiveProof: "enabled" },
  };
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
  const sources = async () =>
    (
      await query<{ payload: unknown }>(sql`
      SELECT payload FROM memory_session_sources WHERE payload->>'sessionId' = ${sessionId}
      ORDER BY capture_sequence`)
    ).map((row) => sessionSourceSchema.parse(row.payload));
  const first = await sources();
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({
    settlement: "accepted",
    kind: "message.settled",
    turnId: "turn_0",
    occurredAt: null,
  });
  expect(first[0]?.text).toContain("Turns:");
  await server.request("/probe/send", {
    address,
    id: randomUUID(),
    message: "cancel-slow",
    auth,
  });
  await expect
    .poll(
      async () => {
        const events = await server.request(`/probe/events/${sessionId}`);
        return JSON.stringify(events).includes("Slow response started.");
      },
      { timeout: 10_000, interval: 50 }
    )
    .toBe(true);
  await server.request(`/probe/cancel/${sessionId}`, {});
  await server.settled(sessionId, 2);
  expect(await sources()).toEqual(first);
  await server.stop();
  const resumed = await runtime(port);
  await resumed.request("/probe/send", {
    address,
    id: randomUUID(),
    message: "continue",
    auth,
  });
  await resumed.settled(sessionId, 3);
  const completed = await sources();
  expect(completed).toHaveLength(2);
  expect(completed[0]).toEqual(first[0]);
  expect(completed[1]?.turnId).toBe("turn_2");
  expect(completed[1]?.text).toContain("Turns:");
  expect(JSON.stringify(completed)).not.toContain("Late response finished.");
  await resumed.stop();
}, 60_000);

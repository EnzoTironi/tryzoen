import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { inputRequestSchema } from "eve/client";
import { z } from "zod";
import { afterAll, beforeAll, expect, test } from "vitest";
import { renderApprovalDisclosure } from "@zoen/companion-ui/approval";
import { readMatrixMessages } from "../../server/matrix/rooms";
import { freePort } from "../helpers/ports";
import { workspaceExecutionFor } from "./workspace-fixture";
import { communityFixture } from "./community-fixture";
import { buildEveFixture, clearFixtureWorkflows, runtime } from "./eve-fixture";
import { matrixReceiver } from "./matrix-fixture";

let receiver: Awaited<ReturnType<typeof matrixReceiver>> | undefined;
beforeAll(async () => {
  receiver = await matrixReceiver();
  await buildEveFixture();
}, 65_000);
afterAll(async () => {
  await receiver?.close();
  await clearFixtureWorkflows();
});

async function waitForNativeEvent(
  server: Awaited<ReturnType<typeof runtime>>,
  sessionId: string,
  text: string
) {
  let events: unknown = [];
  try {
    await expect
      .poll(
        async () => {
          events = await server.request(`/probe/events/${sessionId}`);
          return JSON.stringify(events);
        },
        { timeout: 30_000, interval: 100 }
      )
      .toContain(text);
  } catch (error) {
    await writeFile(
      join(tmpdir(), `zoen-community-events-${sessionId}.json`),
      JSON.stringify(events),
      { mode: 0o600 }
    );
    throw error;
  }
}

async function pendingContribution(
  server: Awaited<ReturnType<typeof runtime>>,
  fixture: Awaited<ReturnType<typeof communityFixture>>
) {
  const principal = workspaceExecutionFor(fixture.first.personal).session.auth
    .current;
  const auth = {
    ...principal,
    attributes: { ...principal.attributes, archiveProof: "enabled" },
  };
  const address = randomUUID();
  const operationId = randomUUID();
  const input = { ...fixture.input, operationId };
  const { sessionId } = z.object({ sessionId: z.string() }).parse(
    await server.request("/probe/send", {
      auth,
      address,
      id: randomUUID(),
      message: `community-contribute ${JSON.stringify(input)}`,
    })
  );
  const pending = await server.settled(sessionId);
  const request = z
    .object({ requests: z.array(inputRequestSchema) })
    .parse(pending.find((event) => event.type === "input.requested")?.data)
    .requests[0];
  if (request?.kind !== "tool-approval")
    throw new Error(
      "Exact community contribution must park at native approval"
    );
  expect(request.action.toolName).toBe("community-contribute");
  expect(request.action.input).toEqual(input);
  expect(
    renderApprovalDisclosure(request.action.toolName, request.action.input).kind
  ).toBe("ready");
  expect(
    pending.filter((event) => event.type === "action.result")
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_contribution_receipts WHERE operation_id = ${operationId}`
    )
  ).toEqual([]);
  expect(
    JSON.stringify(
      (await readMatrixMessages(fixture.first.actor, fixture.firstRoom.id))
        .messages
    )
  ).not.toContain(input.text);
  expect(
    JSON.stringify(
      (await readMatrixMessages(fixture.second.actor, fixture.secondRoom.id))
        .messages
    )
  ).not.toContain(input.text);
  return { auth, address, operationId, input, sessionId, request };
}

test("compiled Eve keeps a contribution private across silence and restart, rejects another member's response, then publishes once for its owner", async () => {
  await using fixture = await communityFixture();
  const port = await freePort();
  const server = await runtime(port);
  const pending = await pendingContribution(server, fixture);
  await server.stop();
  const resumed = await runtime(port);
  const guest = workspaceExecutionFor(fixture.first.guestPersonal).session.auth
    .current;
  const rejected = await resumed.request(`/probe/input/${pending.sessionId}`, {
    auth: guest,
    responses: [{ requestId: pending.request.requestId, optionId: "approve" }],
  });
  expect(rejected).toMatchObject({ status: "accepted" });
  await waitForNativeEvent(
    resumed,
    pending.sessionId,
    "Only the session owner can approve"
  );
  expect(
    await query(
      sql`SELECT 1 FROM matrix_contribution_receipts WHERE operation_id = ${pending.operationId}`
    )
  ).toEqual([]);
  expect(
    JSON.stringify(
      (await readMatrixMessages(fixture.first.actor, fixture.firstRoom.id))
        .messages
    )
  ).not.toContain(pending.input.text);
  const approved = await resumed.request(`/probe/input/${pending.sessionId}`, {
    auth: pending.auth,
    responses: [{ requestId: pending.request.requestId, optionId: "approve" }],
  });
  expect(approved).toMatchObject({ status: "accepted" });
  await waitForNativeEvent(resumed, pending.sessionId, '"status":"published"');
  const events = await resumed.settled(pending.sessionId, 2);
  expect(
    JSON.stringify(events.filter((event) => event.type === "action.result"))
  ).toContain('"status":"published"');
  expect(
    (
      await readMatrixMessages(fixture.first.actor, fixture.firstRoom.id)
    ).messages.filter((item) => item.text === pending.input.text)
  ).toHaveLength(1);
  expect(
    JSON.stringify(
      (await readMatrixMessages(fixture.second.actor, fixture.secondRoom.id))
        .messages
    )
  ).not.toContain(pending.input.text);
  await resumed.request(`/probe/input/${pending.sessionId}`, {
    auth: pending.auth,
    responses: [{ requestId: pending.request.requestId, optionId: "approve" }],
  });
  expect(
    (
      await readMatrixMessages(fixture.first.actor, fixture.firstRoom.id)
    ).messages.filter((item) => item.text === pending.input.text)
  ).toHaveLength(1);
  await resumed.stop();
}, 90_000);

test("refusing a compiled native contribution sends no content or proposal existence to either community", async () => {
  await using fixture = await communityFixture();
  const server = await runtime(await freePort());
  const pending = await pendingContribution(server, fixture);
  await server.request(`/probe/input/${pending.sessionId}`, {
    auth: pending.auth,
    responses: [{ requestId: pending.request.requestId, optionId: "cancel" }],
  });
  await server.settled(pending.sessionId, 2);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_contribution_receipts WHERE operation_id = ${pending.operationId}`
    )
  ).toEqual([]);
  for (const [actor, room] of [
    [fixture.first.actor, fixture.firstRoom],
    [fixture.second.actor, fixture.secondRoom],
  ] as const) {
    const messages = JSON.stringify(
      (await readMatrixMessages(actor, room.id)).messages
    );
    expect(messages).not.toContain(pending.input.text);
    expect(messages).not.toContain(pending.input.purpose);
    expect(messages).not.toContain(pending.operationId);
  }
  await server.stop();
}, 60_000);

test("a private cancellation message dismisses a parked native contribution before execution", async () => {
  await using fixture = await communityFixture();
  const server = await runtime(await freePort());
  const pending = await pendingContribution(server, fixture);
  await server.request(`/probe/message/${pending.sessionId}`, {
    message: "cancel",
    auth: pending.auth,
  });
  await server.settled(pending.sessionId, 2);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_contribution_receipts WHERE operation_id = ${pending.operationId}`
    )
  ).toEqual([]);
  expect(
    JSON.stringify(
      (await readMatrixMessages(fixture.first.actor, fixture.firstRoom.id))
        .messages
    )
  ).not.toContain(pending.input.text);
  await server.stop();
}, 60_000);

test("revoking community membership while Eve waits defeats a later owner approval", async () => {
  await using fixture = await communityFixture();
  const server = await runtime(await freePort());
  const pending = await pendingContribution(server, fixture);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${fixture.first.actor.workspaceId} AND user_id = ${fixture.first.actor.userId}`
  );
  await server.request(`/probe/input/${pending.sessionId}`, {
    auth: pending.auth,
    responses: [{ requestId: pending.request.requestId, optionId: "approve" }],
  });
  await waitForNativeEvent(server, pending.sessionId, "WorkspaceAccessDenied");
  const events = await server.settled(pending.sessionId, 2);
  expect(
    JSON.stringify(events.filter((event) => event.type === "message.completed"))
  ).toContain("WorkspaceAccessDenied");
  expect(
    await query(
      sql`SELECT 1 FROM matrix_contribution_receipts WHERE operation_id = ${pending.operationId}`
    )
  ).toEqual([]);
  expect(
    JSON.stringify(
      (await readMatrixMessages(fixture.second.actor, fixture.secondRoom.id))
        .messages
    )
  ).not.toContain(pending.input.text);
  await server.stop();
}, 60_000);

/**
 * Dedicated PostgreSQL lock proof: only the allocated loopback fixture is allowed.
 * Queries, transactions, admission, strict-session egress and agent revocation are
 * real. The erasure entry below is simulated; this is not account deletion or
 * native provider delivery proof. No provider, Eve process or global PG setting.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { env } from "@shared/environment/env";
import { query, transaction } from "@db/queries";
import {
  lockMatrixAdmission,
  lockMatrixRoomFences,
  requireMatrixEgress,
} from "../../server/matrix/authority";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { revokeExternalAgentMember } from "../../server/workspaces/agent-member-revocation";
import { requireRuntimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";
import { Secret } from "@shared/environment/secret";
import * as matrixClient from "../../server/matrix/client";
import { renameMatrixRoom } from "../../server/matrix/group-name";
import { setMatrixRoomAvatar } from "../../server/matrix/avatar";
import { forwardMatrixMessage } from "../../server/matrix/forward";
import { sendMatrixMessage } from "../../server/matrix/send";
import { setThreadSubscription } from "../../server/matrix/thread-subscriptions";
import { setSavedMatrixMessage } from "../../server/matrix/saved";

function assertAllocatedDatabase() {
  for (const connection of [env.DATABASE_URL, env.DATABASE_URL_UNPOOLED]) {
    assert.ok(connection, "Both allocated database URLs are required.");
    const target = new URL(connection);
    assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
    assert.equal(
      target.hostname,
      "127.0.0.1",
      "Only the allocated loopback host is allowed."
    );
    assert.equal(
      target.port,
      "15441",
      "Only the allocated security fixture port is allowed."
    );
    assert.equal(
      target.pathname,
      "/companion_runtime_test",
      "Only the synthetic runtime database is allowed."
    );
  }
}
// Fail during collection, before setup's read-only database check or any fixture writes.
assertAllocatedDatabase();

let providerCalls = 0;
beforeEach(() => {
  providerCalls = 0;
  vi.stubGlobal("fetch", () => {
    providerCalls += 1;
    throw new Error("Providers are forbidden in this PostgreSQL proof.");
  });
});
afterEach(() => {
  try {
    assert.equal(providerCalls, 0, "No provider calls belong in this proof.");
  } finally {
    vi.unstubAllGlobals();
  }
});

async function matrixFixture(includeAgent = false) {
  assertAllocatedDatabase();
  await requireRuntimeDatabase();
  const workspace = await workspaceFixture();
  const identities = [workspace.actor.userId, workspace.guest.userId];
  const resources = new AsyncDisposableStack();
  resources.defer(async () => {
    assertAllocatedDatabase();
    for (const userId of identities)
      await query(sql`DELETE FROM matrix_identities WHERE user_id = ${userId}`);
  });
  resources.defer(async () => {
    assertAllocatedDatabase();
    await workspace[Symbol.asyncDispose]();
  });
  try {
    const bindingId = randomUUID();
    const epoch = randomUUID();
    const eventId = `$matrix-lock-proof-${randomUUID()}`;
    const sessionId = `matrix-lock-proof:${randomUUID()}`;
    const agentId = randomUUID();
    const [organization] = await query<{ id: string }>(sql`
      SELECT organization_id AS id FROM workspaces WHERE id = ${workspace.actor.workspaceId}`);
    assert.ok(organization);
    await query(sql`INSERT INTO workspace_group_bindings
      (id,workspace_id,channel,installation_id,conversation_id,label,created_by,epoch)
      VALUES (${bindingId},${workspace.actor.workspaceId},'matrix','synthetic.invalid',
        ${`!matrix-lock-proof-${bindingId}:synthetic.invalid`},'Synthetic lock proof',${workspace.actor.userId},${epoch})`);
    if (includeAgent) {
      await query(sql`INSERT INTO workspace_agent_members
        (id,workspace_id,username,name,created_by,registration_operation_id,registration_request_hash)
        VALUES (${agentId},${workspace.actor.workspaceId},'synthetic_agent','Synthetic agent',
          ${workspace.actor.userId},${randomUUID()},${"a".repeat(64)})`);
      identities.push("agent:" + agentId);
    }
    for (const userId of identities) {
      const matrixId = `@_zoen_${createHash("sha256").update(userId).digest("hex").slice(0, 32)}:synthetic.invalid`;
      const displayName =
        userId === workspace.actor.userId
          ? "Synthetic owner"
          : userId === workspace.guest.userId
            ? "Synthetic guest"
            : "Synthetic agent";
      await query(sql`INSERT INTO matrix_identities(user_id,matrix_id,display_name)
        VALUES (${userId},${matrixId},${displayName})`);
      await query(sql`INSERT INTO matrix_room_members(binding_id,user_id)
        VALUES (${bindingId},${userId})`);
    }
    await query(sql`INSERT INTO native_delivery_receipts(workspace_id,input_id,session_id,digest)
      VALUES (${workspace.actor.workspaceId},${eventId},${sessionId},${"b".repeat(64)})`);
    await query(sql`INSERT INTO matrix_deliveries
      (event_id,binding_id,epoch,user_id,message,state,session_id)
      VALUES (${eventId},${bindingId},${epoch},${workspace.actor.userId},'Synthetic input','answer_ready',${sessionId})`);
    return {
      workspace,
      bindingId,
      eventId,
      sessionId,
      agentId,
      organizationId: organization.id,
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}

async function observer() {
  assertAllocatedDatabase();
  const client = new Client({
    connectionString: env.DATABASE_URL,
    options: "-c default_transaction_read_only=on -c statement_timeout=5000",
  });
  try {
    await client.connect();
    const result = await client.query<{ name: string }>(
      "SELECT current_database() AS name"
    );
    assert.equal(result.rows[0]?.name, "companion_runtime_test");
    return { client, [Symbol.asyncDispose]: () => client.end() };
  } catch (error) {
    await client.end();
    throw error;
  }
}

function postgresCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!current || typeof current !== "object") return undefined;
    if ("code" in current && typeof current.code === "string")
      return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

function bounded<Value>(promise: Promise<Value>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("PostgreSQL proof barrier timed out."));
    }, 5000);
  });
  return Promise.race([promise, deadline]).finally(() => {
    clearTimeout(timeout);
  });
}

function participant(run: () => Promise<void>) {
  const pid = Promise.withResolvers<number>();
  const enter = Promise.withResolvers<void>();
  const done = transaction(async () => {
    await query(sql`SET LOCAL statement_timeout = '15s'`);
    await query(sql`SET LOCAL lock_timeout = '12s'`);
    const [backend] = await query<{ pid: number }>(
      sql`SELECT pg_backend_pid() AS pid`
    );
    assert.ok(backend);
    pid.resolve(backend.pid);
    await enter.promise;
    await run();
  }).then(
    () => ({ ok: true as const }),
    (error: unknown) => {
      pid.reject(error);
      return { ok: false as const, error, code: postgresCode(error) };
    }
  );
  return {
    pid: pid.promise,
    start: () => {
      enter.resolve();
    },
    done,
  };
}

async function blockedBy(
  client: Client,
  waiting: number,
  holding: number,
  excludedBlocker?: number
) {
  await expect
    .poll(
      async () => {
        const result = await client.query<{ blocked: boolean }>(
          `
      SELECT $2::integer = ANY(pg_blocking_pids($1::integer))
        AND ($3::integer IS NULL OR NOT ($3::integer = ANY(pg_blocking_pids($1::integer))))
        AND EXISTS (SELECT 1 FROM pg_locks WHERE pid=$1::integer AND NOT granted) AS blocked`,
          [waiting, holding, excludedBlocker ?? null]
        );
        return result.rows[0]?.blocked === true;
      },
      { timeout: 5000, interval: 20 }
    )
    .toBe(true);
}

async function raceEgress(
  fixture: Awaited<ReturnType<typeof matrixFixture>>,
  winner: "egress" | "mutation",
  mutate: () => Promise<void>
) {
  await using observation = await observer();
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const egress = participant(async () => {
    await requireMatrixEgress(fixture.eventId, fixture.sessionId);
    if (winner === "egress") {
      held.resolve();
      await release.promise;
    }
  });
  const mutation = participant(async () => {
    await mutate();
    if (winner === "mutation") {
      held.resolve();
      await release.promise;
    }
  });
  const first = winner === "egress" ? egress : mutation;
  const second = winner === "egress" ? mutation : egress;
  try {
    const [firstPid, secondPid] = await bounded(
      Promise.all([first.pid, second.pid])
    );
    first.start();
    void first.done.then((result) => {
      if (!result.ok) held.reject(result.error);
    });
    await bounded(held.promise);
    second.start();
    await blockedBy(observation.client, secondPid, firstPid);
    release.resolve();
    const [egressResult, mutationResult] = await bounded(
      Promise.all([egress.done, mutation.done])
    );
    expect(mutationResult.ok).toBe(true);
    if (winner === "mutation") {
      assert.equal(egressResult.ok, false);
      assert.ok(egressResult.error instanceof WorkspaceAccessDenied);
    }
    expect(
      [egressResult, mutationResult].some(
        (result) => !result.ok && result.code === "40P01"
      )
    ).toBe(false);
    return egressResult;
  } finally {
    release.resolve();
    egress.start();
    mutation.start();
    await Promise.all([egress.done, mutation.done]);
  }
}

test("legacy member-then-binding versus binding-then-member produces a real PostgreSQL 40P01", async () => {
  await using fixture = await matrixFixture();
  await using observation = await observer();
  const memberHeld = Promise.withResolvers<void>();
  const bindingHeld = Promise.withResolvers<void>();
  const requestBinding = Promise.withResolvers<void>();
  const requestMember = Promise.withResolvers<void>();
  const memberFirst = participant(async () => {
    await query(sql`SELECT user_id FROM workspace_memberships
      WHERE workspace_id=${fixture.workspace.actor.workspaceId} AND user_id=${fixture.workspace.guest.userId} FOR UPDATE`);
    memberHeld.resolve();
    await requestBinding.promise;
    await query(
      sql`SELECT id FROM workspace_group_bindings WHERE id=${fixture.bindingId} FOR UPDATE`
    );
  });
  const bindingFirst = participant(async () => {
    await query(
      sql`SELECT id FROM workspace_group_bindings WHERE id=${fixture.bindingId} FOR UPDATE`
    );
    bindingHeld.resolve();
    await requestMember.promise;
    await query(sql`SELECT user_id FROM workspace_memberships
      WHERE workspace_id=${fixture.workspace.actor.workspaceId} AND user_id=${fixture.workspace.guest.userId} FOR UPDATE`);
  });
  try {
    const [memberPid, bindingPid] = await bounded(
      Promise.all([memberFirst.pid, bindingFirst.pid])
    );
    memberFirst.start();
    await bounded(memberHeld.promise);
    bindingFirst.start();
    await bounded(bindingHeld.promise);
    requestBinding.resolve();
    await blockedBy(observation.client, memberPid, bindingPid);
    requestMember.resolve();
    const results = await bounded(
      Promise.all([memberFirst.done, bindingFirst.done])
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results
        .map((result) => (result.ok ? undefined : result.code))
        .filter(Boolean)
    ).toEqual(["40P01"]);
  } finally {
    requestBinding.resolve();
    requestMember.resolve();
    memberFirst.start();
    bindingFirst.start();
    await Promise.all([memberFirst.done, bindingFirst.done]);
  }
});

// This deliberately models only main's proposed entry fence, not account erasure.
test.each(["egress", "mutation"] as const)(
  "simulated erasure entry and strict-session egress: %s wins without deadlock",
  async (winner) => {
    await using fixture = await matrixFixture();
    const result = await raceEgress(fixture, winner, async () => {
      await lockMatrixAdmission(
        [fixture.workspace.actor.workspaceId],
        [fixture.bindingId],
        "update"
      );
      await query(sql`SELECT user_id FROM workspace_memberships
      WHERE workspace_id=${fixture.workspace.actor.workspaceId} AND user_id=${fixture.workspace.guest.userId} FOR UPDATE`);
      await query(
        sql`SELECT id FROM workspace_group_bindings WHERE id=${fixture.bindingId} FOR UPDATE`
      );
      await query(sql`UPDATE matrix_room_members SET state='removed', native_pending=true
      WHERE binding_id=${fixture.bindingId} AND user_id=${fixture.workspace.guest.userId}`);
      await query(
        sql`UPDATE workspace_group_bindings SET epoch=${randomUUID()} WHERE id=${fixture.bindingId}`
      );
    });
    expect(result.ok).toBe(winner === "egress");
  }
);

test.each(["organizations", "rooms"] as const)(
  "reverse complete %s fence sets acquire in the same order",
  async (domain) => {
    await using left = await matrixFixture();
    await using right = await matrixFixture();
    await using observation = await observer();
    const ordered = [left, right].toSorted((a, b) =>
      a.organizationId < b.organizationId ? -1 : 1
    );
    const workspaces = ordered.map(
      (fixture) => fixture.workspace.actor.workspaceId
    );
    const bindings = [left.bindingId, right.bindingId].toSorted();
    const last = ordered[1];
    const lastBinding = bindings[1];
    assert.ok(last && lastBinding);
    const blockerHeld = Promise.withResolvers<void>();
    const forwardHeld = Promise.withResolvers<void>();
    const releaseBlocker = Promise.withResolvers<void>();
    const releaseForward = Promise.withResolvers<void>();
    const blocker = participant(async () => {
      if (domain === "organizations")
        await lockMatrixAdmission(
          [last.workspace.actor.workspaceId],
          [],
          "update"
        );
      else await lockMatrixRoomFences([lastBinding]);
      blockerHeld.resolve();
      await releaseBlocker.promise;
    });
    const mode = domain === "organizations" ? "update" : "share";
    const forward = participant(async () => {
      await lockMatrixAdmission(workspaces, bindings, mode);
      forwardHeld.resolve();
      await releaseForward.promise;
    });
    const reverse = participant(async () => {
      await lockMatrixAdmission(
        workspaces.toReversed(),
        bindings.toReversed(),
        mode
      );
    });
    try {
      const [blockerPid, forwardPid, reversePid] = await bounded(
        Promise.all([blocker.pid, forward.pid, reverse.pid])
      );
      blocker.start();
      await bounded(blockerHeld.promise);
      forward.start();
      await blockedBy(observation.client, forwardPid, blockerPid);
      reverse.start();
      // PG also reports queued soft blockers. Excluding the held higher fence
      // prevents a reverse participant queued there behind forward from passing.
      await blockedBy(observation.client, reversePid, forwardPid, blockerPid);
      releaseBlocker.resolve();
      await bounded(blocker.done);
      await bounded(forwardHeld.promise);
      releaseForward.resolve();
      const results = await bounded(Promise.all([forward.done, reverse.done]));
      expect(results.every((result) => result.ok)).toBe(true);
    } finally {
      releaseBlocker.resolve();
      releaseForward.resolve();
      blocker.start();
      forward.start();
      reverse.start();
      await Promise.all([blocker.done, forward.done, reverse.done]);
    }
  }
);

test.each(["egress", "mutation"] as const)(
  "real external-agent revocation and egress: %s wins without provider calls",
  async (winner) => {
    await using fixture = await matrixFixture(true);
    const result = await raceEgress(fixture, winner, async () => {
      await revokeExternalAgentMember(fixture.workspace.actor, fixture.agentId);
    });
    expect(result.ok).toBe(winner === "egress");
    const [member] = await query<{ revoked: boolean }>(sql`
    SELECT revoked_at IS NOT NULL AS revoked FROM workspace_agent_members WHERE id=${fixture.agentId}`);
    const [room] = await query<{ state: string; native_pending: boolean }>(sql`
    SELECT state,native_pending FROM matrix_room_members WHERE binding_id=${fixture.bindingId} AND user_id=${"agent:" + fixture.agentId}`);
    expect(member?.revoked).toBe(true);
    expect(room).toMatchObject({ state: "removed", native_pending: true });
  }
);

function mockRoomProvider(beforeRequest?: () => Promise<void>) {
  vi.spyOn(matrixClient, "matrixConfiguration").mockResolvedValue({
    url: "https://synthetic.invalid",
    serverName: "synthetic.invalid",
    botId: "@synthetic:synthetic.invalid",
    token: new Secret("synthetic-unused-token"),
    homeserverToken: new Secret("synthetic-unused-token"),
  });
  let state: Awaited<ReturnType<typeof matrixClient.matrixRequest>> = {};
  return vi
    .spyOn(matrixClient, "matrixRequest")
    .mockImplementation(async (method, path, body) => {
      assert.ok(
        path.endsWith("/state/m.room.name") ||
          path.endsWith("/state/m.room.avatar")
      );
      if (beforeRequest) await beforeRequest();
      if (method === "PUT") {
        assert.ok(body);
        state = body;
        return {};
      }
      assert.equal(method, "GET");
      return state;
    });
}

async function editRoom(
  fixture: Awaited<ReturnType<typeof matrixFixture>>,
  kind: "rename" | "avatar"
) {
  if (kind === "rename") {
    return renameMatrixRoom(fixture.workspace.actor, {
      id: fixture.bindingId,
      expectedName: "Synthetic lock proof",
      name: "Synthetic renamed room",
    });
  }
  return setMatrixRoomAvatar(fixture.workspace.actor, {
    id: fixture.bindingId,
    operationId: randomUUID(),
    expectedRevision: null,
    file: null,
  });
}

test("legacy room-first versus organization-first admission produces PostgreSQL 40P01", async () => {
  await using fixture = await matrixFixture();
  await using observation = await observer();
  const roomHeld = Promise.withResolvers<void>();
  const organizationHeld = Promise.withResolvers<void>();
  const requestOrganization = Promise.withResolvers<void>();
  const requestRoom = Promise.withResolvers<void>();
  const roomFirst = participant(async () => {
    await lockMatrixRoomFences([fixture.bindingId]);
    roomHeld.resolve();
    await requestOrganization.promise;
    await lockMatrixAdmission([fixture.workspace.actor.workspaceId], []);
  });
  const organizationFirst = participant(async () => {
    await lockMatrixAdmission(
      [fixture.workspace.actor.workspaceId],
      [],
      "update"
    );
    organizationHeld.resolve();
    await requestRoom.promise;
    await lockMatrixRoomFences([fixture.bindingId]);
  });
  try {
    const [roomPid, organizationPid] = await bounded(
      Promise.all([roomFirst.pid, organizationFirst.pid])
    );
    roomFirst.start();
    await bounded(roomHeld.promise);
    organizationFirst.start();
    await bounded(organizationHeld.promise);
    requestOrganization.resolve();
    await blockedBy(observation.client, roomPid, organizationPid);
    requestRoom.resolve();
    const results = await bounded(
      Promise.all([roomFirst.done, organizationFirst.done])
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results
        .map((result) => (result.ok ? undefined : result.code))
        .filter(Boolean)
    ).toEqual(["40P01"]);
  } finally {
    requestOrganization.resolve();
    requestRoom.resolve();
    roomFirst.start();
    organizationFirst.start();
    await Promise.all([roomFirst.done, organizationFirst.done]);
  }
});

test.each(["rename", "avatar"] as const)(
  "actual %s provider-boundary winner fences real agent revocation",
  async (kind) => {
    await using fixture = await matrixFixture(true);
    await using observation = await observer();
    const providerHeld = Promise.withResolvers<number>();
    const releaseProvider = Promise.withResolvers<void>();
    let paused = false;
    const native = mockRoomProvider(async () => {
      if (paused) return;
      paused = true;
      const [backend] = await query<{ pid: number }>(
        sql`SELECT pg_backend_pid() AS pid`
      );
      assert.ok(backend);
      providerHeld.resolve(backend.pid);
      await releaseProvider.promise;
    });
    const mutation = participant(async () => {
      await revokeExternalAgentMember(fixture.workspace.actor, fixture.agentId);
    });
    // The actual entry is outside participant's outer transaction: avatar's
    // preflight must release its real locks before its own editing transaction.
    const edit = editRoom(fixture, kind).then(
      () => ({ ok: true as const }),
      (error: unknown) => {
        providerHeld.reject(error);
        return { ok: false as const, error, code: postgresCode(error) };
      }
    );
    try {
      const [mutationPid, editPid] = await bounded(
        Promise.all([mutation.pid, providerHeld.promise])
      );
      mutation.start();
      await blockedBy(observation.client, mutationPid, editPid);
      releaseProvider.resolve();
      const results = await bounded(Promise.all([edit, mutation.done]));
      expect(results.every((result) => result.ok)).toBe(true);
      expect(native).toHaveBeenCalled();
    } finally {
      releaseProvider.resolve();
      mutation.start();
      await Promise.all([edit, mutation.done]);
    }
  }
);

test("real revocation organization winner admits actual rename without room-first inversion", async () => {
  await using fixture = await matrixFixture(true);
  await using observation = await observer();
  mockRoomProvider();
  const organizationHeld = Promise.withResolvers<void>();
  const requestRevocation = Promise.withResolvers<void>();
  const mutation = participant(async () => {
    // Pause the same real admission helper before revocation requests its rooms.
    // This exposes the original inversion instead of letting it finish first.
    await lockMatrixAdmission(
      [fixture.workspace.actor.workspaceId],
      [],
      "update"
    );
    organizationHeld.resolve();
    await requestRevocation.promise;
    await revokeExternalAgentMember(fixture.workspace.actor, fixture.agentId);
  });
  const edit = participant(async () => {
    await editRoom(fixture, "rename");
  });
  try {
    const [mutationPid, editPid] = await bounded(
      Promise.all([mutation.pid, edit.pid])
    );
    mutation.start();
    await bounded(organizationHeld.promise);
    edit.start();
    await blockedBy(observation.client, editPid, mutationPid);
    requestRevocation.resolve();
    const results = await bounded(Promise.all([mutation.done, edit.done]));
    expect(results.every((result) => result.ok)).toBe(true);
  } finally {
    requestRevocation.resolve();
    mutation.start();
    edit.start();
    await Promise.all([mutation.done, edit.done]);
  }
});

function mockMessageProvider(
  beforeRequest?: (method: string, path: string) => Promise<void>
) {
  const native = mockRoomProvider();
  const messages = new Map<
    string,
    Awaited<ReturnType<typeof matrixClient.matrixRequest>>
  >();
  native.mockImplementation(
    async (
      method,
      path,
      body,
      userId,
      options
    ): ReturnType<typeof matrixClient.matrixRequest> => {
      if (beforeRequest) await beforeRequest(method, path);
      if (path === "versions") {
        assert.equal(options?.version, "");
        return { unstable_features: { "org.matrix.msc4306": true } };
      }
      const parts = path.split("/");
      assert.equal(parts[0], "rooms");
      assert.ok(parts[1]);
      const roomId = decodeURIComponent(parts[1]);
      if (parts[2] === "send") {
        assert.equal(method, "PUT");
        assert.ok(body && userId);
        const eventId = `$synthetic-copy-${randomUUID()}`;
        messages.set(`${roomId}:${eventId}`, {
          event_id: eventId,
          room_id: roomId,
          sender: userId,
          type: "m.room.message",
          content: body,
        });
        return { event_id: eventId };
      }
      if (parts[2] === "event") {
        assert.equal(method, "GET");
        assert.ok(parts[3] && userId);
        const eventId = decodeURIComponent(parts[3]);
        return (
          messages.get(`${roomId}:${eventId}`) ?? {
            event_id: eventId,
            room_id: roomId,
            sender: userId,
            type: "m.room.message",
            content: { msgtype: "m.text", body: "Synthetic root" },
          }
        );
      }
      assert.equal(parts[2], "thread");
      assert.equal(parts[4], "subscription");
      assert.equal(options?.version, "unstable/io.element.msc4306");
      assert.ok(["GET", "PUT", "DELETE"].includes(method));
      return method === "GET" ? { automatic: false } : {};
    }
  );
  return native;
}

async function additionalRoom(
  fixture: Awaited<ReturnType<typeof matrixFixture>>
) {
  assertAllocatedDatabase();
  const id = randomUUID();
  await query(sql`INSERT INTO workspace_group_bindings
    (id,workspace_id,channel,installation_id,conversation_id,label,created_by)
    VALUES (${id},${fixture.workspace.actor.workspaceId},'matrix','synthetic.invalid',
      ${`!matrix-lock-proof-${id}:synthetic.invalid`},'Synthetic second room',${fixture.workspace.actor.userId})`);
  await query(sql`INSERT INTO matrix_room_members(binding_id,user_id)
    VALUES (${id},${fixture.workspace.actor.userId})`);
  return id;
}

test("actual opposed forwards fence the complete sorted room set before either join", async () => {
  await using fixture = await matrixFixture();
  await using observation = await observer();
  mockMessageProvider();
  const ids = [fixture.bindingId, await additionalRoom(fixture)].toSorted();
  const low = ids[0];
  const high = ids[1];
  assert.ok(low && high);
  const blockerHeld = Promise.withResolvers<void>();
  const releaseBlocker = Promise.withResolvers<void>();
  const blocker = participant(async () => {
    await lockMatrixRoomFences([high]);
    blockerHeld.resolve();
    await releaseBlocker.promise;
  });
  const forward = participant(async () => {
    const result = await forwardMatrixMessage(fixture.workspace.actor, {
      id: low,
      destinationId: high,
      messageId: "$synthetic-original-a",
      expectedRevision: "$synthetic-original-a",
      operationId: randomUUID(),
    });
    assert.equal(result.status, "sent");
  });
  const reverse = participant(async () => {
    const result = await forwardMatrixMessage(fixture.workspace.actor, {
      id: high,
      destinationId: low,
      messageId: "$synthetic-original-b",
      expectedRevision: "$synthetic-original-b",
      operationId: randomUUID(),
    });
    assert.equal(result.status, "sent");
  });
  try {
    const [blockerPid, forwardPid, reversePid] = await bounded(
      Promise.all([blocker.pid, forward.pid, reverse.pid])
    );
    blocker.start();
    await bounded(blockerHeld.promise);
    forward.start();
    await blockedBy(observation.client, forwardPid, blockerPid);
    reverse.start();
    await blockedBy(observation.client, reversePid, forwardPid, blockerPid);
    releaseBlocker.resolve();
    const results = await bounded(
      Promise.all([blocker.done, forward.done, reverse.done])
    );
    expect(results.every((result) => result.ok)).toBe(true);
  } finally {
    releaseBlocker.resolve();
    blocker.start();
    forward.start();
    reverse.start();
    await Promise.all([blocker.done, forward.done, reverse.done]);
  }
});

test("synthetic nested room-then-thread versus thread-then-room composition produces 40P01", async () => {
  await using fixture = await matrixFixture();
  await using observation = await observer();
  const thread = `matrix-thread-subscription:${fixture.workspace.actor.userId}:${fixture.bindingId}:$synthetic-root`;
  const roomHeld = Promise.withResolvers<void>();
  const threadHeld = Promise.withResolvers<void>();
  const requestThread = Promise.withResolvers<void>();
  const requestRoom = Promise.withResolvers<void>();
  const roomFirst = participant(async () => {
    await lockMatrixAdmission(
      [fixture.workspace.actor.workspaceId],
      [fixture.bindingId]
    );
    roomHeld.resolve();
    await requestThread.promise;
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${thread}, 0))`
    );
  });
  const threadFirst = participant(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${thread}, 0))`
    );
    threadHeld.resolve();
    await requestRoom.promise;
    await lockMatrixAdmission(
      [fixture.workspace.actor.workspaceId],
      [fixture.bindingId]
    );
  });
  try {
    const [roomPid, threadPid] = await bounded(
      Promise.all([roomFirst.pid, threadFirst.pid])
    );
    roomFirst.start();
    await bounded(roomHeld.promise);
    threadFirst.start();
    await bounded(threadHeld.promise);
    requestThread.resolve();
    await blockedBy(observation.client, roomPid, threadPid);
    requestRoom.resolve();
    const results = await bounded(
      Promise.all([roomFirst.done, threadFirst.done])
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results
        .map((result) => (result.ok ? undefined : result.code))
        .filter(Boolean)
    ).toEqual(["40P01"]);
  } finally {
    requestThread.resolve();
    requestRoom.resolve();
    roomFirst.start();
    threadFirst.start();
    await Promise.all([roomFirst.done, threadFirst.done]);
  }
});

test("actual manual subscription holds room admission before waiting on its thread fence", async () => {
  await using fixture = await matrixFixture();
  await using observation = await observer();
  mockMessageProvider();
  const rootId = "$synthetic-root";
  const thread = `matrix-thread-subscription:${fixture.workspace.actor.userId}:${fixture.bindingId}:${rootId}`;
  const blockerHeld = Promise.withResolvers<void>();
  const releaseBlocker = Promise.withResolvers<void>();
  const blocker = participant(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${thread}, 0))`
    );
    blockerHeld.resolve();
    await releaseBlocker.promise;
  });
  const manual = participant(async () => {
    const result = await setThreadSubscription(fixture.workspace.actor, {
      id: fixture.bindingId,
      rootId,
      following: true,
    });
    assert.equal(result.status, "ready");
  });
  const roomProbe = participant(async () => {
    await lockMatrixAdmission(
      [fixture.workspace.actor.workspaceId],
      [fixture.bindingId]
    );
  });
  try {
    const [blockerPid, manualPid, probePid] = await bounded(
      Promise.all([blocker.pid, manual.pid, roomProbe.pid])
    );
    blocker.start();
    await bounded(blockerHeld.promise);
    manual.start();
    await blockedBy(observation.client, manualPid, blockerPid);
    roomProbe.start();
    await blockedBy(observation.client, probePid, manualPid, blockerPid);
    releaseBlocker.resolve();
    const results = await bounded(
      Promise.all([blocker.done, manual.done, roomProbe.done])
    );
    expect(results.every((result) => result.ok)).toBe(true);
  } finally {
    releaseBlocker.resolve();
    blocker.start();
    manual.start();
    roomProbe.start();
    await Promise.all([blocker.done, manual.done, roomProbe.done]);
  }
});

// Standalone send commits its publication transaction before automatic subscription.
// This checks actual concurrent product calls, not exploitability of the synthetic cycle.
test("standalone actual threaded send and manual subscription serialize without an outer send transaction", async () => {
  await using fixture = await matrixFixture();
  await using observation = await observer();
  const publicationHeld = Promise.withResolvers<number>();
  const releasePublication = Promise.withResolvers<void>();
  let paused = false;
  mockMessageProvider(async (method, path) => {
    if (paused || method !== "PUT" || !path.includes("/send/")) return;
    paused = true;
    const [backend] = await query<{ pid: number }>(
      sql`SELECT pg_backend_pid() AS pid`
    );
    assert.ok(backend);
    publicationHeld.resolve(backend.pid);
    await releasePublication.promise;
  });
  const rootId = "$synthetic-root";
  const manual = participant(async () => {
    const result = await setThreadSubscription(fixture.workspace.actor, {
      id: fixture.bindingId,
      rootId,
      following: false,
    });
    assert.equal(result.status, "ready");
  });
  // Do not nest this call in participant(): that would retain publication locks.
  const send = sendMatrixMessage(fixture.workspace.actor, {
    id: fixture.bindingId,
    rootId,
    operationId: randomUUID(),
    text: "Synthetic reply",
  }).then(
    (result) => ({ ok: true as const, result }),
    (error: unknown) => {
      publicationHeld.reject(error);
      return { ok: false as const, error, code: postgresCode(error) };
    }
  );
  try {
    const [manualPid, publicationPid] = await bounded(
      Promise.all([manual.pid, publicationHeld.promise])
    );
    manual.start();
    await blockedBy(observation.client, manualPid, publicationPid);
    releasePublication.resolve();
    const [sendResult, manualResult] = await bounded(
      Promise.all([send, manual.done])
    );
    expect(manualResult.ok).toBe(true);
    expect(sendResult.ok).toBe(true);
    assert.ok(sendResult.ok);
    expect(sendResult.result.subscription).toMatchObject({ status: "ready" });
  } finally {
    releasePublication.resolve();
    manual.start();
    await Promise.all([send, manual.done]);
  }
});

function mockSavedProvider(beforeRead?: () => Promise<void>) {
  const native = mockMessageProvider();
  const readMessage = native.getMockImplementation();
  assert.ok(readMessage);
  let saved: Awaited<ReturnType<typeof matrixClient.matrixRequest>> = {
    version: 1,
    items: [],
  };
  native.mockImplementation(
    async (...args): ReturnType<typeof matrixClient.matrixRequest> => {
      const [method, path, body, userId, options] = args;
      if (!path.endsWith("/account_data/org.zoen.saved_messages"))
        return readMessage(...args);
      assert.ok(userId);
      assert.equal(
        path,
        `user/${encodeURIComponent(userId)}/account_data/org.zoen.saved_messages`
      );
      if (method === "PUT") {
        assert.ok(body);
        saved = body;
        return {};
      }
      assert.equal(method, "GET");
      assert.equal(options?.maxResponseBytes, 262144);
      if (beforeRead) await beforeRead();
      return saved;
    }
  );
  return native;
}

// The other participant models only org UPDATE -> member UPDATE entry order.
// Its unchanged-role write is not account erasure or membership revocation.
test.each(["saved", "mutation"] as const)(
  "actual saved-message writer and simulated organization/member entry: %s wins",
  async (winner) => {
    await using fixture = await matrixFixture();
    await using observation = await observer();
    const firstHeld = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    let paused = false;
    const native = mockSavedProvider(async () => {
      if (winner !== "saved" || paused) return;
      paused = true;
      firstHeld.resolve();
      await releaseFirst.promise;
    });
    const writer = participant(async () => {
      const result = await setSavedMatrixMessage(fixture.workspace.actor, {
        id: fixture.bindingId,
        messageId: "$synthetic-saved-message",
        saved: true,
        expectedRevision: createHash("sha256")
          .update(JSON.stringify({ version: 1, items: [] }))
          .digest("hex"),
      });
      assert.equal(result.status, "saved");
    });
    const mutation = participant(async () => {
      await lockMatrixAdmission(
        [fixture.workspace.actor.workspaceId],
        [],
        "update"
      );
      if (winner === "mutation") {
        firstHeld.resolve();
        await releaseFirst.promise;
      }
      const rows = await query(sql`UPDATE workspace_memberships SET role = role
      WHERE workspace_id = ${fixture.workspace.actor.workspaceId}
        AND user_id = ${fixture.workspace.actor.userId} RETURNING user_id`);
      assert.equal(rows.length, 1);
    });
    const first = winner === "saved" ? writer : mutation;
    const second = winner === "saved" ? mutation : writer;
    try {
      const [firstPid, secondPid] = await bounded(
        Promise.all([first.pid, second.pid])
      );
      first.start();
      void first.done.then((result) => {
        if (!result.ok) firstHeld.reject(result.error);
      });
      await bounded(firstHeld.promise);
      second.start();
      await blockedBy(observation.client, secondPid, firstPid);
      releaseFirst.resolve();
      const results = await bounded(Promise.all([writer.done, mutation.done]));
      expect(results.every((result) => result.ok)).toBe(true);
      expect(
        native.mock.calls.filter(
          ([method, path]) =>
            method === "PUT" &&
            path.endsWith("/account_data/org.zoen.saved_messages")
        )
      ).toHaveLength(1);
    } finally {
      releaseFirst.resolve();
      writer.start();
      mutation.start();
      await Promise.all([writer.done, mutation.done]);
    }
  }
);

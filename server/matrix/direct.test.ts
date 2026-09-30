/** Real DM admission/authentication with owning SQL and native transport mocks.
 * Lock ordering here is deterministic; PostgreSQL concurrency is qualified separately. */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { query, transaction } from "@db/queries";
import type { ensureMatrixIdentity } from "./identities";
import { MatrixError, type matrixRequest } from "./client";
import { WorkspaceAccessDenied } from "../workspaces/access";
import { openDirectRoom } from "./direct";

const mocks = vi.hoisted(() => ({
  query: vi.fn<typeof query>(),
  transaction: vi.fn<typeof transaction>(),
  identity: vi.fn<typeof ensureMatrixIdentity>(),
  request: vi.fn<typeof matrixRequest>(),
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: mocks.transaction,
}));
vi.mock("./identities", () => ({ ensureMatrixIdentity: mocks.identity }));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({
    serverName: "synthetic.invalid",
    botId: "@synthetic-bot:synthetic.invalid",
  }),
}));

const actor = {
  userId: "better-auth:synthetic-actor",
  workspaceId: "synthetic-workspace",
  authSessionId: "synthetic-session",
};
const peerId = "better-auth:synthetic-peer";
const organizationId = "synthetic-organization";
const input = {
  username: "synthetic_peer",
  operationId: "10000000-0000-4000-8000-000000000001",
};
const nativeRoomId = "!synthetic-direct:synthetic.invalid";
const pair = [actor.userId, peerId].toSorted();
const matrixIds = {
  [actor.userId]: "@synthetic-actor:synthetic.invalid",
  [peerId]: "@synthetic-peer:synthetic.invalid",
};
const room = {
  id: input.operationId,
  workspaceId: actor.workspaceId,
  roomId: nativeRoomId,
  label: "Synthetic peer",
  epoch: input.operationId,
  kind: "direct",
  username: input.username,
};
const dialect = new PgDialect();
const order: string[] = [];
let workspacePresent = true;
let mappingChanged = false;
let locatorReads = 0;
let actorAllowed = true;
let sessionAllowed = true;
let peerAllowed = true;
let pairExists = false;
let inserted = false;
let nativeConflict = false;

function queryRows(statement: Parameters<typeof query>[0]) {
  const { sql: raw, params } = dialect.sqlToQuery(statement);
  const text = raw.replace(/\s+/gu, " ").trim();
  if (text.startsWith('SELECT w.id AS "workspaceId"')) {
    expect(params).toEqual([actor.workspaceId]);
    order.push("locate");
    locatorReads++;
    return workspacePresent
      ? [
          {
            workspaceId: actor.workspaceId,
            organizationId:
              mappingChanged && locatorReads > 1
                ? "other-organization"
                : organizationId,
          },
        ]
      : [];
  }
  if (text.startsWith("SELECT id FROM organizations")) {
    expect(params).toEqual([organizationId]);
    expect(text).toContain("FOR SHARE");
    order.push("organization");
    return [{ id: organizationId }];
  }
  if (text.startsWith("SELECT m.role, w.organization_id")) {
    expect(params).toEqual([actor.userId, actor.workspaceId]);
    expect(text).toContain("FOR SHARE OF m, w");
    order.push("actor-membership");
    return actorAllowed
      ? [{ role: "admin", organization_id: organizationId }]
      : [];
  }
  if (text.startsWith("SELECT user_id FROM organization_memberships")) {
    expect(params).toEqual([organizationId, actor.userId]);
    order.push("actor-organization-membership");
    return [{ user_id: actor.userId }];
  }
  if (text.startsWith("SELECT id FROM public.session")) {
    expect(params).toEqual([actor.authSessionId, actor.userId]);
    order.push("actor-session");
    return sessionAllowed ? [{ id: actor.authSessionId }] : [];
  }
  if (text.startsWith('SELECT m.user_id AS "userId"')) {
    expect(params).toEqual([input.username, actor.workspaceId, actor.userId]);
    expect(text).toContain("FOR SHARE OF m, o");
    order.push("peer-membership");
    return peerAllowed ? [{ userId: peerId }] : [];
  }
  if (
    text.startsWith("SELECT pg_advisory_xact_lock") &&
    text.includes(", 17)")
  ) {
    expect(params).toEqual([JSON.stringify([actor.workspaceId, ...pair])]);
    order.push("pair-fence");
    return [];
  }
  if (
    text.startsWith("SELECT pg_advisory_xact_lock") &&
    text.includes(", 18)")
  ) {
    const userId = params[0];
    if (typeof userId !== "string")
      throw new Error("An identity fence must name its user.");
    order.push(`identity-fence:${userId}`);
    return [];
  }
  if (
    text.startsWith("SELECT id FROM matrix_direct_rooms WHERE workspace_id")
  ) {
    expect(params).toEqual([actor.workspaceId, ...pair]);
    return pairExists ? [{ id: input.operationId }] : [];
  }
  if (text.startsWith("SELECT id FROM matrix_direct_rooms WHERE id")) {
    expect(params).toEqual([input.operationId]);
    return [];
  }
  if (text.startsWith("INSERT INTO matrix_direct_rooms")) {
    expect(params).toEqual([
      input.operationId,
      actor.workspaceId,
      ...pair,
      nativeRoomId,
      "synthetic.invalid",
    ]);
    inserted = true;
    return [];
  }
  if (text.startsWith('SELECT d.id, d.workspace_id AS "workspaceId"')) {
    expect(params).toEqual([
      actor.userId,
      input.operationId,
      actor.workspaceId,
      "synthetic.invalid",
      actor.userId,
    ]);
    return pairExists || inserted ? [room] : [];
  }
  throw new Error(`Unexpected DM admission SQL: ${text}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  order.length = 0;
  workspacePresent = true;
  mappingChanged = false;
  locatorReads = 0;
  actorAllowed = true;
  sessionAllowed = true;
  peerAllowed = true;
  pairExists = false;
  inserted = false;
  nativeConflict = false;
  mocks.transaction.mockImplementation(async (run) => run());
  mocks.query.mockImplementation(async (statement) => queryRows(statement));
  mocks.identity.mockImplementation(async ({ userId }) => {
    const matrixId = matrixIds[userId];
    if (!matrixId) throw new Error("Only synthetic identities may be used.");
    order.push(`identity:${userId}`);
    return matrixId;
  });
  mocks.request.mockImplementation(
    async (method, path): ReturnType<typeof matrixRequest> => {
      if (method === "POST" && path === "createRoom") {
        if (nativeConflict) throw new MatrixError({ reason: "conflict" });
        return { room_id: nativeRoomId };
      }
      if (method === "GET" && path.startsWith("directory/room/"))
        return { room_id: nativeRoomId };
      if (
        method === "POST" &&
        path === `join/${encodeURIComponent(nativeRoomId)}`
      )
        return {};
      if (
        path.endsWith("/account_data/m.direct") &&
        (method === "GET" || method === "PUT")
      )
        return {};
      throw new Error(`Unexpected synthetic DM request: ${method} ${path}`);
    }
  );
  mocks.fetch.mockRejectedValue(new Error("Real providers are forbidden."));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

test("takes the complete organization fence before locking either participant", async () => {
  expect(await openDirectRoom(actor, input)).toEqual(room);
  expect(order.slice(0, 7)).toEqual([
    "locate",
    "organization",
    "locate",
    "actor-membership",
    "actor-organization-membership",
    "actor-session",
    "peer-membership",
  ]);
  expect(order.slice(7, 10)).toEqual([
    "pair-fence",
    ...pair.map((userId) => `identity-fence:${userId}`),
  ]);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test.each(["missing workspace", "changed organization mapping"])(
  "%s fails admission before actor, peer, identity or native effects",
  async (mode) => {
    workspacePresent = mode !== "missing workspace";
    mappingChanged = mode === "changed organization mapping";
    await expect(openDirectRoom(actor, input)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(order).toEqual(
      mode === "missing workspace"
        ? ["locate"]
        : ["locate", "organization", "locate"]
    );
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(inserted).toBe(false);
  }
);

test.each(["actor membership", "actor session", "peer membership"])(
  "still requires current %s after admission",
  async (missing) => {
    actorAllowed = missing !== "actor membership";
    sessionAllowed = missing !== "actor session";
    peerAllowed = missing !== "peer membership";
    await expect(openDirectRoom(actor, input)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(inserted).toBe(false);
  }
);

test("an existing authorized pair does not provision another room or identity", async () => {
  pairExists = true;
  expect(await openDirectRoom(actor, input)).toEqual(room);
  expect(order).toContain("pair-fence");
  expect(order.some((entry) => entry.startsWith("identity-fence:"))).toBe(
    false
  );
  expect(mocks.identity).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(inserted).toBe(false);
});

test.each(["create", "native conflict replay"])(
  "%s preserves private native room creation, recipient join and both account-data maps",
  async (mode) => {
    nativeConflict = mode === "native conflict replay";
    expect(await openDirectRoom(actor, input)).toEqual(room);
    expect(mocks.request).toHaveBeenCalledWith(
      "POST",
      "createRoom",
      expect.objectContaining({
        preset: "private_chat",
        visibility: "private",
        is_direct: true,
        invite: [matrixIds[peerId]],
        creation_content: { "m.federate": false },
        initial_state: [
          {
            type: "m.room.history_visibility",
            state_key: "",
            content: { history_visibility: "joined" },
          },
        ],
      }),
      matrixIds[actor.userId]
    );
    expect(mocks.request).toHaveBeenCalledWith(
      "POST",
      `join/${encodeURIComponent(nativeRoomId)}`,
      {},
      matrixIds[peerId]
    );
    for (const [userId, other] of [
      [actor.userId, peerId],
      [peerId, actor.userId],
    ]) {
      if (!userId || !other)
        throw new Error("Both synthetic participants are required.");
      const matrixId = matrixIds[userId];
      const peerMatrixId = matrixIds[other];
      if (!matrixId || !peerMatrixId)
        throw new Error("Both synthetic Matrix identities are required.");
      expect(mocks.request).toHaveBeenCalledWith(
        "PUT",
        `user/${encodeURIComponent(matrixId)}/account_data/m.direct`,
        { [peerMatrixId]: [nativeRoomId] },
        matrixId
      );
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(inserted).toBe(true);
  }
);

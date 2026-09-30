/** SQL/provider-boundary tests of the real room admission and membership paths.
 * Transactions and locks are recorded, not implemented: this proves call order
 * and fail-closed behavior, not PostgreSQL or homeserver linearizability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { matrixRequest } from "./client";
import { MatrixError } from "./client";
import {
  changeMatrixGroupMembership,
  reconcileGroupDepartures,
} from "./membership";
import {
  closeMatrixRoom,
  createMatrixRoom,
  joinMatrixRoom,
  listMatrixRooms,
  reconcileMatrixRooms,
  requireMatrixRoom,
  requireJoinedMatrixRoom,
} from "./rooms";
import { WorkspaceAccessDenied } from "../workspaces/access";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  request: vi.fn<typeof matrixRequest>(),
  identity: vi.fn<(actor: { userId: string }) => Promise<string>>(),
  register: vi.fn<(localpart: string) => Promise<void>>(),
  transaction: vi.fn<(phase: "begin" | "commit" | "rollback") => void>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  async transaction<Result>(run: () => Promise<Result>) {
    mocks.transaction("begin");
    try {
      const result = await run();
      mocks.transaction("commit");
      return result;
    } catch (error) {
      mocks.transaction("rollback");
      throw error;
    }
  },
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({
    botId: "@zoen:synthetic.invalid",
    serverName: "synthetic.invalid",
  }),
}));
vi.mock("./identities", () => ({
  ensureMatrixIdentity: mocks.identity,
  registerVirtualUser: mocks.register,
}));

const bindingId = "10000000-0000-4000-8000-000000000001";
const actor = {
  userId: "better-auth:synthetic-owner",
  workspaceId: "synthetic-workspace",
  authSessionId: "synthetic-session",
};
const target = "better-auth:synthetic-member";
const room = {
  id: bindingId,
  workspaceId: actor.workspaceId,
  roomId: "!synthetic-room:synthetic.invalid",
  kind: "group",
  label: "Synthetic room",
  epoch: "20000000-0000-4000-8000-000000000001",
};
const members = new Map<
  string,
  { state: "joined" | "left" | "removed"; native_pending: boolean }
>();
const trace: string[] = [];
const statements: string[] = [];
const dialect = new PgDialect();
let requesterAuthorized = true;
let sessionCurrent = true;
let groupActive = true;
let groupInstallation = "synthetic.invalid";
let directPair = false;
let directPairAuthorized = true;
const identities = new Map<string, string>();
let locatorChanges = false;
let locatorReads = 0;
let nativeState = "leave";
let confirmDeparture = true;
let failKick = false;
let created = false;
let rootTransactionDepth = 0;
let heldBinding: ReturnType<typeof Promise.withResolvers<void>> | undefined;
let bindingReached: ReturnType<typeof Promise.withResolvers<void>> | undefined;

function nativeId(userId: string) {
  return `@${userId.slice("better-auth:".length)}:synthetic.invalid`;
}

async function rows(statement: SQL) {
  const compiled = dialect.sqlToQuery(statement);
  const text = compiled.sql.replace(/\s+/gu, " ").trim();
  const params = compiled.params;
  statements.push(text);
  if (
    text.includes(
      'SELECT w.id AS "workspaceId", w.organization_id AS "organizationId"'
    )
  ) {
    trace.push("locator");
    locatorReads++;
    return [
      {
        workspaceId: actor.workspaceId,
        organizationId:
          locatorChanges && locatorReads === 2
            ? "changed-org"
            : "synthetic-org",
      },
    ];
  }
  if (text.startsWith("SELECT id FROM organizations")) {
    trace.push("organization");
    expect(params).toEqual(["synthetic-org"]);
    return [{ id: "synthetic-org" }];
  }
  if (text.startsWith("SELECT pg_advisory_xact_lock")) {
    trace.push(text.includes(", 4)") ? "workspace-fence" : "room-fence");
    return [];
  }
  if (text.startsWith("SELECT m.role, w.organization_id")) {
    trace.push("authority");
    return requesterAuthorized
      ? [{ role: "owner", organization_id: "synthetic-org" }]
      : [];
  }
  if (text.startsWith("SELECT user_id FROM organization_memberships"))
    return [{ user_id: actor.userId }];
  if (text.startsWith("SELECT id FROM public.session")) {
    trace.push("current-session");
    expect(text).toContain('"expiresAt" > clock_timestamp() FOR SHARE');
    expect(params).toEqual([actor.authSessionId, actor.userId]);
    return sessionCurrent ? [{ id: actor.authSessionId }] : [];
  }
  if (text.startsWith('SELECT d.id, d.workspace_id AS "workspaceId"')) {
    trace.push("direct-pair-share");
    expect(text).toContain("FOR SHARE OF d, a, b, oa, ob");
    expect(params).toEqual([
      actor.userId,
      bindingId,
      actor.workspaceId,
      "synthetic.invalid",
      actor.userId,
    ]);
    return directPair && directPairAuthorized
      ? [{ ...room, kind: "direct" }]
      : [];
  }
  if (text.startsWith('SELECT b.id, b.workspace_id AS "workspaceId"')) {
    trace.push("joined-room-share");
    expect(rootTransactionDepth).toBeGreaterThan(0);
    expect(text).toContain("m.state = 'joined' AND NOT m.native_pending");
    expect(text).toContain("i.user_id = m.user_id");
    expect(text).toContain("b.channel = 'matrix'");
    expect(text).toContain("b.installation_id = $4 AND b.revoked_at IS NULL");
    expect(text).toContain("FOR SHARE OF b, m, i");
    expect(params).toEqual([
      actor.userId,
      bindingId,
      actor.workspaceId,
      "synthetic.invalid",
    ]);
    const member = members.get(actor.userId);
    const matrixId = identities.get(actor.userId);
    return groupActive &&
      !directPair &&
      groupInstallation === params[3] &&
      member?.state === "joined" &&
      !member.native_pending &&
      matrixId
      ? [{ ...room, matrixId }]
      : [];
  }
  if (
    text.startsWith('SELECT matrix_id AS "matrixId" FROM matrix_identities')
  ) {
    trace.push("identity-share");
    expect(rootTransactionDepth).toBeGreaterThan(0);
    expect(text).toContain("FOR SHARE");
    expect(params).toEqual([actor.userId]);
    const matrixId = identities.get(actor.userId);
    return matrixId ? [{ matrixId }] : [];
  }
  if (text.startsWith('SELECT w.user_id AS "userId", w.role'))
    return [{ userId: target, role: "member" }];
  if (
    text.startsWith(
      'SELECT conversation_id AS "roomId" FROM workspace_group_bindings'
    )
  ) {
    trace.push("binding-update");
    expect(text).toContain("FOR UPDATE");
    return [{ roomId: room.roomId }];
  }
  if (text.startsWith('SELECT id, workspace_id AS "workspaceId"')) {
    trace.push("binding-share");
    return [room];
  }
  if (text.startsWith("SELECT id FROM workspace_group_bindings")) {
    if (text.includes("FOR UPDATE")) {
      trace.push("binding-update");
      bindingReached?.resolve();
      await heldBinding?.promise;
      return [{ id: bindingId }];
    }
    if (text.includes("WHERE workspace_id")) return [];
    return created ? [{ id: bindingId }] : [];
  }
  if (
    text.startsWith("SELECT state, native_pending FROM matrix_room_members")
  ) {
    const member = members.get(z.string().parse(params[1]));
    return member ? [{ ...member }] : [];
  }
  if (text.startsWith("SELECT user_id FROM matrix_room_members"))
    return members.has(actor.userId) ? [{ user_id: actor.userId }] : [];
  if (
    text.startsWith(
      'SELECT b.conversation_id AS "roomId", i.matrix_id AS "matrixId", m.state'
    )
  ) {
    const userId = z.string().parse(params[1]);
    const member = members.get(userId);
    trace.push("retirement-row-lock");
    return member?.native_pending && member.state !== "joined"
      ? [
          {
            roomId: room.roomId,
            matrixId: nativeId(userId),
            state: member.state,
          },
        ]
      : [];
  }
  if (text.startsWith("INSERT INTO matrix_room_members")) {
    const userId = z.string().parse(params[1]);
    const state = z
      .enum(["joined", "removed", "left"])
      .parse(params[2] ?? "joined");
    members.set(userId, { state, native_pending: state !== "joined" });
    trace.push("local-membership-write");
    return [];
  }
  if (text.startsWith("INSERT INTO workspace_group_bindings")) {
    created = true;
    return [];
  }
  if (text.startsWith("UPDATE workspace_group_bindings SET epoch")) {
    trace.push("epoch-write");
    return [];
  }
  if (text.startsWith("UPDATE workspace_group_bindings SET revoked_at"))
    return [];
  if (
    text.startsWith("UPDATE matrix_room_members SET native_pending = false")
  ) {
    const member = members.get(z.string().parse(params[1]));
    if (member) member.native_pending = false;
    trace.push("pending-cleared");
    return [];
  }
  if (text.startsWith("UPDATE matrix_room_members SET native_retry_at")) {
    trace.push("retry-scheduled");
    return [];
  }
  if (text.startsWith('SELECT binding_id AS "bindingId", user_id AS "userId"'))
    return members.get(target)?.native_pending
      ? [{ bindingId, userId: target }]
      : [];
  if (text.startsWith('SELECT m.binding_id AS "bindingId"'))
    return members.get(target)?.state === "joined"
      ? [
          {
            bindingId,
            userId: target,
            matrixId: nativeId(target),
            roomId: room.roomId,
          },
        ]
      : [];
  // The future reconciliation owner revalidates the binding and stale member
  // under admission before committing the existing pending-retirement receipt.
  if (text.startsWith('SELECT b.workspace_id AS "workspaceId"')) {
    trace.push("binding-update");
    expect(text).toContain("FOR UPDATE");
    return [{ workspaceId: actor.workspaceId }];
  }
  if (text.startsWith("UPDATE matrix_room_members m SET state = 'removed'")) {
    members.set(target, { state: "removed", native_pending: true });
    trace.push("local-membership-write");
    return [{ user_id: target }];
  }
  if (text.startsWith("DELETE FROM matrix_room_members")) {
    members.delete(target);
    trace.push("membership-deleted");
    return [];
  }
  throw new Error(`Unexpected SQL in mocked membership test: ${text}`);
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Real network calls are forbidden.");
  });
  members.clear();
  trace.length = 0;
  statements.length = 0;
  requesterAuthorized = true;
  sessionCurrent = true;
  groupActive = true;
  groupInstallation = "synthetic.invalid";
  directPair = false;
  directPairAuthorized = true;
  identities.clear();
  identities.set(actor.userId, nativeId(actor.userId));
  locatorChanges = false;
  locatorReads = 0;
  nativeState = "leave";
  confirmDeparture = true;
  failKick = false;
  created = false;
  rootTransactionDepth = 0;
  heldBinding = undefined;
  bindingReached = undefined;
  mocks.query.mockReset().mockImplementation(rows);
  mocks.transaction.mockReset().mockImplementation((phase) => {
    if (phase === "begin") {
      rootTransactionDepth++;
      if (rootTransactionDepth === 1) trace.push("transaction-begin");
    } else {
      if (rootTransactionDepth === 1) trace.push(phase);
      rootTransactionDepth--;
    }
  });
  mocks.identity.mockReset().mockImplementation(async (person) => {
    trace.push("native-identity");
    return nativeId(person.userId);
  });
  mocks.register.mockReset().mockImplementation(async () => {
    trace.push("native-register");
  });
  mocks.request
    .mockReset()
    .mockImplementation(
      async (method, path): ReturnType<typeof matrixRequest> => {
        if (method === "GET" && path.includes("/state/m.room.member/")) {
          trace.push("native-state");
          return { membership: nativeState };
        }
        if (method === "GET" && path.endsWith("/joined_members"))
          return {
            joined: nativeState === "join" ? { [nativeId(target)]: {} } : {},
          };
        if (method === "POST" && path.endsWith("/invite")) {
          trace.push("native-invite");
          nativeState = "invite";
          return {};
        }
        if (method === "POST" && path.startsWith("join/")) {
          trace.push("native-join");
          nativeState = "join";
          return {};
        }
        if (
          method === "POST" &&
          (path.endsWith("/kick") || path.endsWith("/leave"))
        ) {
          trace.push("native-retire");
          if (failKick) throw new MatrixError({ reason: "unavailable" });
          if (confirmDeparture) nativeState = "leave";
          return {};
        }
        if (method === "POST" && path === "createRoom")
          return { room_id: room.roomId };
        throw new Error(`Unexpected mocked provider call: ${method} ${path}`);
      }
    );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function expectAdmissionBeforeAuthority() {
  expect(trace.indexOf("organization")).toBeGreaterThanOrEqual(0);
  expect(trace.indexOf("room-fence")).toBeGreaterThan(
    trace.indexOf("organization")
  );
  expect(trace.indexOf("authority")).toBeGreaterThan(
    trace.indexOf("room-fence")
  );
}

describe("membership admission and native join order", () => {
  it("orders organization, room fence and authority before member addition/native I/O", async () => {
    await changeMatrixGroupMembership(actor, {
      id: bindingId,
      action: "add",
      username: "synthetic_member",
    });
    expectAdmissionBeforeAuthority();
    expect(trace.indexOf("native-identity")).toBeGreaterThan(
      trace.indexOf("binding-update")
    );
    expect(members.get(target)).toEqual({
      state: "joined",
      native_pending: false,
    });
  });
  it("fails before authority/native I/O when the workspace organization changes during locator validation", async () => {
    locatorChanges = true;
    await expect(
      changeMatrixGroupMembership(actor, {
        id: bindingId,
        action: "add",
        username: "synthetic_member",
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    expect(trace).not.toContain("authority");
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("takes a conflicting binding lock before native identity or an initial native join", async () => {
    await joinMatrixRoom(actor, bindingId);
    expectAdmissionBeforeAuthority();
    expect(trace.indexOf("binding-update")).toBeGreaterThanOrEqual(0);
    expect(trace.indexOf("native-identity")).toBeGreaterThan(
      trace.indexOf("binding-update")
    );
    expect(trace.indexOf("native-join")).toBeGreaterThan(
      trace.indexOf("binding-update")
    );
    expect(members.get(actor.userId)).toEqual({
      state: "joined",
      native_pending: false,
    });
  });
  it("performs no native I/O while an earlier output holds the conflicting binding lock", async () => {
    heldBinding = Promise.withResolvers<void>();
    bindingReached = Promise.withResolvers<void>();
    const joined = joinMatrixRoom(actor, bindingId);
    try {
      await Promise.race([
        bindingReached.promise,
        joined.then(() => {
          throw new Error("Initial join passed the still-held binding lock.");
        }),
      ]);
      expect(mocks.identity).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    } finally {
      heldBinding.resolve();
    }
    await joined;
    expect(mocks.identity).toHaveBeenCalledExactlyOnceWith(actor);
  });
  it("denies native join when current requester authority is absent", async () => {
    requesterAuthorized = false;
    await expect(joinMatrixRoom(actor, bindingId)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("room entry ordering", () => {
  it.each([
    { name: "require", run: () => requireMatrixRoom(actor, bindingId) },
    { name: "close", run: () => closeMatrixRoom(actor, bindingId) },
  ])(
    "$name fences the room before its first authority read",
    async ({ run }) => {
      await run();
      expectAdmissionBeforeAuthority();
      expect(trace).toContain("room-fence");
    }
  );
  it("lists rooms under an organization fence before workspace authority", async () => {
    await listMatrixRooms(actor);
    expect(trace.indexOf("organization")).toBeGreaterThanOrEqual(0);
    expect(trace.indexOf("authority")).toBeGreaterThan(
      trace.indexOf("organization")
    );
  });
  it("creates inside a transaction with organization before workspace/key4 and room/key5 before authority", async () => {
    await createMatrixRoom(actor, {
      operationId: bindingId,
      name: "Synthetic room",
    });
    expect(trace[0]).toBe("transaction-begin");
    expectAdmissionBeforeAuthority();
    expect(trace.indexOf("workspace-fence")).toBeGreaterThan(
      trace.indexOf("organization")
    );
  });
});

describe("exact native retirement receipts", () => {
  it("retains a locally removed pending receipt when a successful kick still reads native joined", async () => {
    members.set(target, { state: "joined", native_pending: false });
    nativeState = "join";
    confirmDeparture = false;
    await expect(
      changeMatrixGroupMembership(actor, {
        id: bindingId,
        action: "remove",
        username: "synthetic_member",
      })
    ).resolves.toEqual({ nativePending: true });
    expect(members.get(target)).toEqual({
      state: "removed",
      native_pending: true,
    });
    expect(trace.indexOf("native-retire")).toBeGreaterThan(
      trace.indexOf("commit")
    );
    expect(trace).not.toContain("pending-cleared");
  });
  it("retries pending retirement under organization then room ordering and confirms exact leave", async () => {
    members.set(target, { state: "removed", native_pending: true });
    nativeState = "join";
    await reconcileGroupDepartures();
    expect(trace.indexOf("organization")).toBeGreaterThanOrEqual(0);
    expect(trace.indexOf("room-fence")).toBeGreaterThan(
      trace.indexOf("organization")
    );
    expect(trace.indexOf("retirement-row-lock")).toBeGreaterThan(
      trace.indexOf("room-fence")
    );
    expect(members.get(target)).toEqual({
      state: "removed",
      native_pending: false,
    });
  });
  it("reconciliation commits a removed/pending receipt before native kick and retains it when native confirmation fails", async () => {
    members.set(target, { state: "joined", native_pending: false });
    nativeState = "join";
    confirmDeparture = false;
    await reconcileMatrixRooms();
    expect(members.get(target)).toEqual({
      state: "removed",
      native_pending: true,
    });
    expect(trace.indexOf("native-retire")).toBeGreaterThan(
      trace.indexOf("commit")
    );
    expect(trace).not.toContain("membership-deleted");
    expect(trace).not.toContain("pending-cleared");
  });
  it("reconciliation keeps the removed tombstone after confirmed native absence", async () => {
    members.set(target, { state: "joined", native_pending: false });
    nativeState = "join";
    await reconcileMatrixRooms();
    expect(members.get(target)).toEqual({
      state: "removed",
      native_pending: false,
    });
    expect(trace).not.toContain("membership-deleted");
    expect(trace.filter((entry) => entry === "native-state")).toHaveLength(2);
    expect(statements.some((text) => text.includes("LIMIT 10"))).toBe(true);
  });

  it("reconciliation retains the committed departure receipt when the native kick fails", async () => {
    members.set(target, { state: "joined", native_pending: false });
    nativeState = "join";
    failKick = true;
    await reconcileMatrixRooms();
    expect(members.get(target)).toEqual({
      state: "removed",
      native_pending: true,
    });
    expect(trace.indexOf("native-retire")).toBeGreaterThan(
      trace.indexOf("commit")
    );
    expect(trace).toContain("retry-scheduled");
    expect(trace).not.toContain("membership-deleted");
    expect(trace).not.toContain("pending-cleared");
  });
  it("does not perform retirement provider I/O if the organization locator changed", async () => {
    members.set(target, { state: "joined", native_pending: false });
    locatorChanges = true;
    await expect(reconcileMatrixRooms()).rejects.toThrow(WorkspaceAccessDenied);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(members.get(target)).toEqual({
      state: "joined",
      native_pending: false,
    });
  });
});

describe("confirmed human room admission without enrollment", () => {
  it("returns the durable joined identity while locking current authority and room/member/identity rows", async () => {
    members.set(actor.userId, { state: "joined", native_pending: false });
    await expect(requireJoinedMatrixRoom(actor, bindingId)).resolves.toEqual({
      ...room,
      matrixId: nativeId(actor.userId),
    });
    expectAdmissionBeforeAuthority();
    expect(trace.indexOf("joined-room-share")).toBeGreaterThan(
      trace.indexOf("current-session")
    );
    expect(trace.at(-1)).toBe("commit");
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(trace).not.toContain("local-membership-write");
    expect(trace).not.toContain("epoch-write");
  });

  it.each([
    { label: "absent", member: undefined },
    {
      label: "pending join",
      member: { state: "joined" as const, native_pending: true },
    },
    {
      label: "removed",
      member: { state: "removed" as const, native_pending: false },
    },
    {
      label: "pending removal",
      member: { state: "removed" as const, native_pending: true },
    },
    {
      label: "left",
      member: { state: "left" as const, native_pending: false },
    },
  ])(
    "denies $label without registration, join or membership writes",
    async ({ member }) => {
      if (member) members.set(actor.userId, member);
      await expect(requireJoinedMatrixRoom(actor, bindingId)).rejects.toThrow(
        WorkspaceAccessDenied
      );
      expect(mocks.identity).not.toHaveBeenCalled();
      expect(mocks.register).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
      expect(trace).not.toContain("local-membership-write");
      expect(trace).not.toContain("epoch-write");
    }
  );

  it.each([
    "missing",
    "other owner",
    "other server",
    "server suffix",
    "malformed",
  ])(
    "denies a %s durable identity without synthesizing a handle",
    async (variant) => {
      members.set(actor.userId, { state: "joined", native_pending: false });
      if (variant === "missing") identities.clear();
      if (variant === "other owner") {
        identities.clear();
        identities.set(target, nativeId(actor.userId));
      }
      if (variant === "other server")
        identities.set(actor.userId, "@member:other.invalid");
      if (variant === "server suffix")
        identities.set(actor.userId, "@member:other.invalid:synthetic.invalid");
      if (variant === "malformed")
        identities.set(actor.userId, "member:synthetic.invalid");
      await expect(requireJoinedMatrixRoom(actor, bindingId)).rejects.toThrow(
        WorkspaceAccessDenied
      );
      expect(mocks.identity).not.toHaveBeenCalled();
      expect(mocks.register).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    }
  );

  it.each([
    "closed binding",
    "other installation",
    "revoked workspace access",
    "expired session",
  ])("denies %s before native effects", async (variant) => {
    members.set(actor.userId, { state: "joined", native_pending: false });
    if (variant === "closed binding") groupActive = false;
    if (variant === "other installation") groupInstallation = "other.invalid";
    if (variant === "revoked workspace access") requesterAuthorized = false;
    if (variant === "expired session") sessionCurrent = false;
    await expect(requireJoinedMatrixRoom(actor, bindingId)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(trace.includes("joined-room-share")).toBe(
      requesterAuthorized && sessionCurrent
    );
  });

  it.each([
    { label: "missing session", identity: { authSessionId: undefined } },
    { label: "group context", identity: { groupBindingId: bindingId } },
    { label: "protocol context", identity: { protocolTaskId: bindingId } },
  ])(
    "denies $label instead of accepting delegated identity",
    async ({ identity }) => {
      members.set(actor.userId, { state: "joined", native_pending: false });
      await expect(
        requireJoinedMatrixRoom({ ...actor, ...identity }, bindingId)
      ).rejects.toThrow(WorkspaceAccessDenied);
      expect(trace).not.toContain("joined-room-share");
      expect(mocks.identity).not.toHaveBeenCalled();
      expect(mocks.register).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    }
  );

  it("preserves real direct-pair authorization and locks its existing durable identity", async () => {
    directPair = true;
    await expect(requireJoinedMatrixRoom(actor, bindingId)).resolves.toEqual({
      ...room,
      kind: "direct",
      matrixId: nativeId(actor.userId),
    });
    expect(trace).toContain("direct-pair-share");
    expect(trace).toContain("identity-share");
    expect(trace).not.toContain("joined-room-share");
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("does not register a missing direct identity after pair authorization", async () => {
    directPair = true;
    identities.clear();
    await expect(requireJoinedMatrixRoom(actor, bindingId)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(trace).toContain("direct-pair-share");
    expect(trace).toContain("identity-share");
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("denies a person outside the direct pair despite workspace administrator access", async () => {
    directPair = true;
    directPairAuthorized = false;
    await expect(requireJoinedMatrixRoom(actor, bindingId)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(trace).not.toContain("identity-share");
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

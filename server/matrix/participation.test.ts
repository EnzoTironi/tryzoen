/** Mock the owning database and provider, keeping real transaction/admission/auth
 * behavior. Committed SQL state and native effects have separate lifetimes.
 * This models rollback/restart schedules; it is not a PostgreSQL/provider proof.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { matrixRoomMembers } from "../../db/schema/matrix";
import { transaction, TransactionBoundaryError } from "@db/queries";
import { WorkspaceAccessDenied } from "../workspaces/access";
import { MatrixError, type matrixRequest } from "./client";
import {
  stageMatrixIdentity,
  ensureMatrixIdentity,
  matrixIdentityForUser,
} from "./identities";
import {
  ensureMatrixParticipation,
  completeMatrixGroupJoin,
  pendingMatrixGroupJoins,
} from "./participation";

const boundary = vi.hoisted(() => {
  const execute =
    vi.fn<(statement: SQL) => Promise<{ rows: Record<string, unknown>[] }>>();
  const nested =
    vi.fn<
      (
        run: (tx: { execute: typeof execute }) => Promise<unknown>
      ) => Promise<unknown>
    >();
  return {
    outer: vi.fn<Parameters<typeof nested.mockImplementation>[0]>(),
    nested,
    execute,
    request: vi.fn<typeof matrixRequest>(),
  };
});
vi.mock("@db", () => ({
  db: { transaction: boundary.outer, execute: boundary.execute },
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: boundary.request,
  matrixConfiguration: async () => ({
    serverName: "participation.invalid",
    botId: "@_zoen_bot:participation.invalid",
  }),
}));

const actor = {
  userId: "better-auth:participation-member",
  workspaceId: "participation-workspace",
  authSessionId: "participation-session",
};
const bindingId = "10000000-0000-4000-8000-000000000099";
const localpart = "_zoen_cb6fbddeaf4d3da5368002aa15973ad1";
const matrixId = `@${localpart}:participation.invalid`;
const room = {
  id: bindingId,
  workspaceId: actor.workspaceId,
  roomId: "!participation:participation.invalid",
  label: "Participation fixture",
  epoch: "10000000-0000-4000-8000-000000000001",
  kind: "group",
};
function emptyState() {
  return {
    identities: new Map<string, string>(),
    members: new Map<
      string,
      Pick<typeof matrixRoomMembers.$inferSelect, "state" | "nativePending">
    >(),
    epoch: room.epoch,
    due: true,
    retryTimes: new Map<string, number>(),
  };
}
function copyState(state: ReturnType<typeof emptyState>) {
  return {
    ...state,
    identities: new Map(state.identities),
    retryTimes: new Map(state.retryTimes),
    members: new Map(
      [...state.members].map(([key, value]) => [key, { ...value }])
    ),
  };
}
let committed = emptyState();
let active = committed;
const trace: string[] = [];
const statements: string[] = [];
let sessionValid = true;
let membershipValid = true;
let accountLive = true;
let activeBinding = true;
let commitNumber = 0;
let failCommitAt = 0;
let nativeState: "leave" | "invite" | "join" | "ban" = "leave";
let nativeRegistered = false;
let providerFailure:
  | "none"
  | "join-ack"
  | "register-ack"
  | "verify"
  | "wrong-state"
  | "forbidden" = "none";
let membershipGets = 0;
let now = 0;
let afterPrepare: (() => void) | undefined;
let holdCommit: ReturnType<typeof Promise.withResolvers<void>> | undefined;
let callbackFinished:
  | ReturnType<typeof Promise.withResolvers<void>>
  | undefined;
const dialect = new PgDialect();

async function rows(statement: SQL) {
  const compiled = dialect.sqlToQuery(statement);
  const text = compiled.sql.replace(/\s+/gu, " ").trim();
  const params = compiled.params;
  statements.push(text);
  if (
    text.includes(
      'SELECT w.id AS "workspaceId", w.organization_id AS "organizationId"'
    )
  )
    return [
      { workspaceId: actor.workspaceId, organizationId: "participation-org" },
    ];
  if (text.startsWith("SELECT id FROM organizations")) {
    trace.push("org-share");
    expect(text).toContain("FOR SHARE");
    return [{ id: "participation-org" }];
  }
  if (text.includes("pg_advisory_xact_lock")) {
    trace.push("room-fence");
    return [];
  }
  if (text.startsWith("SELECT m.role, w.organization_id")) {
    trace.push("live-member");
    expect(text).toContain("FOR SHARE OF m, w");
    return membershipValid
      ? [{ role: "member", organization_id: "participation-org" }]
      : [];
  }
  if (text.startsWith("SELECT user_id FROM organization_memberships"))
    return membershipValid ? [{ user_id: actor.userId }] : [];
  if (text.startsWith("SELECT id FROM public.session")) {
    trace.push("current-session");
    expect(text).toContain('"expiresAt" > clock_timestamp() FOR SHARE');
    return sessionValid ? [{ id: actor.authSessionId }] : [];
  }
  if (text.startsWith("SELECT id FROM public.user")) {
    trace.push("live-account");
    expect(text).toContain("FOR SHARE");
    return accountLive ? [{ id: "participation-member" }] : [];
  }
  if (text.startsWith("SELECT d.id,")) return [];
  if (text.startsWith('SELECT id, workspace_id AS "workspaceId"')) {
    const member = active.members.get(actor.userId);
    return activeBinding && (!member || member.state === "joined")
      ? [{ ...room, epoch: active.epoch }]
      : [];
  }
  if (text.startsWith("SELECT id FROM workspace_group_bindings")) {
    trace.push("binding-update");
    expect(text).toContain("FOR UPDATE");
    return activeBinding ? [{ id: bindingId }] : [];
  }
  if (
    text.startsWith(
      'SELECT matrix_id AS "matrixId", display_name AS "displayName"'
    )
  ) {
    trace.push("identity-reread");
    expect(text).not.toContain("FOR SHARE");
    expect(text).not.toContain("FOR UPDATE");
    const identity = active.identities.get(actor.userId);
    return identity ? [{ matrixId: identity, displayName: "" }] : [];
  }
  if (text.startsWith("INSERT INTO matrix_identities")) {
    trace.push("identity-stage");
    expect(params).toEqual([actor.userId, matrixId]);
    if (!active.identities.has(actor.userId))
      active.identities.set(actor.userId, matrixId);
    return [];
  }
  if (text.startsWith('SELECT state, native_pending AS "nativePending"')) {
    const member = active.members.get(actor.userId);
    return member
      ? [
          {
            ...member,
            due: active.due,
            retryAfterMs: active.due ? 1000 : 60000,
          },
        ]
      : [];
  }
  if (text.startsWith("INSERT INTO matrix_room_members")) {
    trace.push("intent-stage");
    expect(params).toEqual([bindingId, actor.userId]);
    expect(text).toContain("native_pending");
    expect(text).toContain("true");
    active.members.set(actor.userId, { state: "joined", nativePending: true });
    return [];
  }
  if (text.startsWith("UPDATE workspace_group_bindings SET epoch")) {
    trace.push("epoch-stage");
    active.epoch = String(params[0]);
    return [];
  }
  if (
    text.startsWith(
      'SELECT b.workspace_id AS "workspaceId", b.conversation_id AS "roomId"'
    )
  ) {
    trace.push("completion-row-lock");
    expect(text).toContain("FOR UPDATE OF b, m FOR SHARE OF i");
    expect(text).toContain("m.native_pending");
    expect(params).toEqual([actor.userId, bindingId, "participation.invalid"]);
    const member = active.members.get(actor.userId);
    const identity = active.identities.get(actor.userId);
    return activeBinding &&
      member?.state === "joined" &&
      member.nativePending &&
      identity
      ? [
          {
            workspaceId: actor.workspaceId,
            roomId: room.roomId,
            matrixId: identity,
            due: active.due,
          },
        ]
      : [];
  }
  if (text.startsWith('SELECT b.id, b.workspace_id AS "workspaceId"')) {
    const member = active.members.get(actor.userId);
    const identity = active.identities.get(actor.userId);
    return activeBinding &&
      member?.state === "joined" &&
      !member.nativePending &&
      identity
      ? [{ ...room, epoch: active.epoch, matrixId: identity }]
      : [];
  }
  if (
    text.startsWith("UPDATE matrix_room_members SET native_pending = false")
  ) {
    trace.push("pending-clear");
    const member = active.members.get(actor.userId);
    if (member) member.nativePending = false;
    return [];
  }
  if (text.startsWith("UPDATE matrix_room_members SET native_retry_at")) {
    trace.push("retry-stage");
    active.due = false;
    active.retryTimes.set(String(params[1]), now + 60000);
    return [];
  }
  if (text.startsWith("UPDATE matrix_room_members SET state = 'removed'")) {
    active.members.set(actor.userId, { state: "removed", nativePending: true });
    return [];
  }
  if (
    text.startsWith('SELECT binding_id AS "bindingId", user_id AS "userId"')
  ) {
    expect(params.at(-1)).toBeLessThanOrEqual(10);
    expect(text).toContain("ORDER BY native_retry_at, binding_id, user_id");
    return [...committed.members.entries()]
      .filter(
        ([userId, member]) =>
          member.state === "joined" &&
          member.nativePending &&
          (userId !== actor.userId || committed.due) &&
          (committed.retryTimes.get(userId) ?? 0) <= now
      )
      .toSorted(
        ([left], [right]) =>
          (committed.retryTimes.get(left) ?? 0) -
          (committed.retryTimes.get(right) ?? 0)
      )
      .slice(0, Number(params.at(-1)))
      .map(([userId]) => ({ bindingId, userId }));
  }
  if (
    text.startsWith(
      'SELECT b.conversation_id AS "roomId", i.matrix_id AS "matrixId", m.state'
    )
  ) {
    const member = active.members.get(actor.userId);
    const identity = active.identities.get(actor.userId);
    return member?.state !== "joined" && member?.nativePending && identity
      ? [{ roomId: room.roomId, matrixId: identity, state: member.state }]
      : [];
  }
  if (text.startsWith("SELECT u.name AS name")) return [];
  throw new Error(`Unexpected mocked SQL: ${text}`);
}

async function nativeProvider(
  ...args: Parameters<typeof matrixRequest>
): ReturnType<typeof matrixRequest> {
  const [method, path, body, userId] = args;
  trace.push(`native:${method}:${path}`);
  expect(committed.identities.get(actor.userId)).toBe(matrixId);
  if (path === "register") {
    expect(body).toEqual({
      type: "m.login.application_service",
      username: localpart,
      inhibit_login: true,
    });
    const wasRegistered = nativeRegistered;
    nativeRegistered = true;
    if (providerFailure === "register-ack")
      throw new MatrixError({ reason: "unavailable" });
    if (wasRegistered) throw new MatrixError({ reason: "conflict" });
    return { user_id: matrixId };
  }
  expect(committed.members.get(actor.userId)?.nativePending).toBe(true);
  expect(committed.epoch).not.toBe(room.epoch);
  if (method === "GET" && path.includes("/state/m.room.member/")) {
    expect(path).toContain(encodeURIComponent(matrixId));
    membershipGets++;
    if (providerFailure === "verify" && membershipGets > 1)
      throw new MatrixError({ reason: "unavailable" });
    return {
      membership:
        providerFailure === "wrong-state" && membershipGets > 1
          ? "leave"
          : nativeState,
    };
  }
  if (method === "POST" && path.endsWith("/invite")) {
    if (providerFailure === "forbidden")
      throw new MatrixError({ reason: "forbidden" });
    expect(body).toEqual({ user_id: matrixId });
    nativeState = "invite";
    return {};
  }
  if (method === "POST" && path.startsWith("join/")) {
    expect(userId).toBe(matrixId);
    nativeState = "join";
    if (providerFailure === "join-ack")
      throw new MatrixError({ reason: "unavailable" });
    return {};
  }
  throw new Error(`Unexpected provider: ${method} ${path}`);
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Real providers are forbidden.");
  });
  committed = emptyState();
  active = committed;
  trace.length = 0;
  statements.length = 0;
  sessionValid = membershipValid = accountLive = activeBinding = true;
  commitNumber = failCommitAt = membershipGets = now = 0;
  nativeState = "leave";
  nativeRegistered = false;
  providerFailure = "none";
  afterPrepare = undefined;
  holdCommit = callbackFinished = undefined;
  vi.clearAllMocks();
  boundary.execute.mockImplementation(async (statement: SQL) => ({
    rows: await rows(statement),
  }));
  const tx = { execute: boundary.execute, transaction: boundary.nested };
  boundary.outer.mockImplementation(async (run) => {
    const number = ++commitNumber;
    const previous = active;
    active = copyState(committed);
    try {
      const result = await run(tx);
      if (number === 1) {
        callbackFinished?.resolve();
        await holdCommit?.promise;
      }
      if (number === failCommitAt)
        throw new Error("Synthetic owning commit failure");
      committed = copyState(active);
      trace.push(`commit:${number}`);
      if (number === 1) afterPrepare?.();
      return result;
    } finally {
      active = previous === committed ? committed : previous;
    }
  });
  boundary.nested.mockImplementation(async (run) => run(tx));
  boundary.request.mockImplementation(nativeProvider);
});
afterEach(() => vi.unstubAllGlobals());

function pendingIntent() {
  committed.identities.set(actor.userId, matrixId);
  committed.members.set(actor.userId, { state: "joined", nativePending: true });
  committed.epoch = "10000000-0000-4000-8000-000000000002";
  active = committed;
}

describe("durable Matrix participation", () => {
  it("stages the canonical SQL identity without registering it", async () => {
    await expect(
      transaction(() => stageMatrixIdentity(actor), { outermost: true })
    ).resolves.toMatchObject({ localpart, matrixId });
    expect(committed.identities.get(actor.userId)).toBe(matrixId);
    expect(boundary.request).not.toHaveBeenCalled();
  });
  it("registers an already staged identity instead of treating SQL presence as proof", async () => {
    committed.identities.set(actor.userId, matrixId);
    await ensureMatrixIdentity(actor);
    expect(boundary.request).toHaveBeenCalledWith(
      "POST",
      "register",
      expect.objectContaining({ username: localpart })
    );
  });
  it("waits for the owning preparation commit before any provider effect", async () => {
    holdCommit = Promise.withResolvers<void>();
    callbackFinished = Promise.withResolvers<void>();
    const result = ensureMatrixParticipation(actor, bindingId);
    try {
      await callbackFinished.promise;
      expect(committed.identities.size).toBe(0);
      expect(committed.members.size).toBe(0);
      expect(boundary.request).not.toHaveBeenCalled();
    } finally {
      holdCommit.resolve();
    }
    await expect(result).resolves.toMatchObject({
      status: "joined",
      room: { id: bindingId },
    });
    expect(trace.indexOf("identity-stage")).toBeGreaterThan(
      trace.indexOf("binding-update")
    );
    expect(
      trace.findIndex((event) => event.startsWith("native:"))
    ).toBeGreaterThan(trace.indexOf("commit:1"));
    expect(committed.members.get(actor.userId)?.nativePending).toBe(false);
  });
  it("rejects nested preparation before callback, savepoint or provider effects", async () => {
    await transaction(async () => {
      await expect(ensureMatrixParticipation(actor, bindingId)).rejects.toThrow(
        TransactionBoundaryError
      );
    });
    expect(boundary.nested).not.toHaveBeenCalled();
    expect(boundary.request).not.toHaveBeenCalled();
    expect(committed.identities.size).toBe(0);
  });
  it("rejects nested scheduled completion before provider effects", async () => {
    pendingIntent();
    await transaction(async () => {
      await expect(
        completeMatrixGroupJoin(bindingId, actor.userId)
      ).rejects.toThrow(TransactionBoundaryError);
    });
    expect(boundary.nested).not.toHaveBeenCalled();
    expect(boundary.request).not.toHaveBeenCalled();
  });
  it("does not register or join when preparation's owning commit fails", async () => {
    failCommitAt = 1;
    await expect(ensureMatrixParticipation(actor, bindingId)).rejects.toThrow(
      "Synthetic owning commit failure"
    );
    expect(committed.identities.size).toBe(0);
    expect(committed.members.size).toBe(0);
    expect(boundary.request).not.toHaveBeenCalled();
  });
  it.each(["register-ack", "join-ack", "verify", "wrong-state"] as const)(
    "retains exact pending intent/epoch after %s uncertainty",
    async (failure) => {
      providerFailure = failure;
      const result = await ensureMatrixParticipation(actor, bindingId);
      expect(result).toEqual({
        status: "pending",
        id: bindingId,
        retryAfterMs: 30000,
      });
      expect(committed.identities.get(actor.userId)).toBe(matrixId);
      expect(committed.members.get(actor.userId)).toEqual({
        state: "joined",
        nativePending: true,
      });
      expect(committed.epoch).not.toBe(room.epoch);
      expect(trace).not.toContain("pending-clear");
    }
  );
  it("repairs a lost join acknowledgement after restart through exact GET without a second join", async () => {
    providerFailure = "join-ack";
    await ensureMatrixParticipation(actor, bindingId);
    const epoch = committed.epoch;
    expect(nativeState).toBe("join");
    providerFailure = "none";
    committed.due = true;
    membershipGets = 0;
    boundary.request.mockClear();
    await expect(
      completeMatrixGroupJoin(bindingId, actor.userId)
    ).resolves.toBe(true);
    expect(committed.members.get(actor.userId)?.nativePending).toBe(false);
    expect(committed.epoch).toBe(epoch);
    expect(
      boundary.request.mock.calls.some(
        ([method, path]) => method === "POST" && path.startsWith("join/")
      )
    ).toBe(false);
    expect(boundary.request).toHaveBeenCalledWith(
      "POST",
      "register",
      expect.objectContaining({ username: localpart })
    );
  });
  it("retains the committed marker when the verification commit fails after native join", async () => {
    failCommitAt = 2;
    await expect(ensureMatrixParticipation(actor, bindingId)).rejects.toThrow(
      "Synthetic owning commit failure"
    );
    expect(nativeState).toBe("join");
    expect(committed.members.get(actor.userId)?.nativePending).toBe(true);
    failCommitAt = 0;
    boundary.request.mockClear();
    await expect(
      completeMatrixGroupJoin(bindingId, actor.userId)
    ).resolves.toBe(true);
    expect(
      boundary.request.mock.calls.some(
        ([method, path]) => method === "POST" && path.startsWith("join/")
      )
    ).toBe(false);
  });
  it("rechecks the foreground session after preparation and never turns expiry into pending", async () => {
    afterPrepare = () => {
      sessionValid = false;
    };
    await expect(ensureMatrixParticipation(actor, bindingId)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(committed.members.get(actor.userId)?.nativePending).toBe(true);
    expect(boundary.request).not.toHaveBeenCalled();
  });
  it("recovers a stored intent using live membership without a stale human session", async () => {
    pendingIntent();
    sessionValid = false;
    await expect(
      completeMatrixGroupJoin(bindingId, actor.userId)
    ).resolves.toBe(true);
    expect(trace).toContain("live-member");
    expect(trace).toContain("live-account");
    expect(trace).not.toContain("current-session");
  });
  it("withdraws a revoked target's join intent before scheduling existing retirement", async () => {
    pendingIntent();
    membershipValid = false;
    await expect(
      completeMatrixGroupJoin(bindingId, actor.userId)
    ).resolves.toBe(false);
    expect(committed.members.get(actor.userId)).toEqual({
      state: "removed",
      nativePending: false,
    });
    // Existing retirement may verify native absence; it must not enroll again.
    expect(
      boundary.request.mock.calls.every(
        ([method, path]) =>
          method === "GET" && path.includes("/state/m.room.member/")
      )
    ).toBe(true);
  });
  it.each(["left", "removed"])(
    "never silently restores a %s member",
    async (state) => {
      pendingIntent();
      committed.members.set(actor.userId, { state, nativePending: false });
      await expect(ensureMatrixParticipation(actor, bindingId)).rejects.toThrow(
        WorkspaceAccessDenied
      );
      expect(boundary.request).not.toHaveBeenCalled();
      expect(committed.members.get(actor.userId)?.state).toBe(state);
    }
  );
  it("rejects a mismatched durable canonical handle before provider I/O", async () => {
    pendingIntent();
    committed.identities.set(actor.userId, "@other:participation.invalid");
    await expect(ensureMatrixParticipation(actor, bindingId)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(boundary.request).not.toHaveBeenCalled();
  });
  it.each(["ban", "forbidden"] as const)(
    "keeps %s terminal rather than returning pending",
    async (failure) => {
      if (failure === "ban") nativeState = "ban";
      else providerFailure = "forbidden";
      await expect(
        ensureMatrixParticipation(actor, bindingId)
      ).rejects.toMatchObject({ reason: "forbidden" });
      expect(committed.members.get(actor.userId)?.nativePending).toBe(true);
      expect(trace).not.toContain("pending-clear");
    }
  );
  it("returns joined without registration or epoch mutation for an already confirmed member", async () => {
    pendingIntent();
    committed.members.set(actor.userId, {
      state: "joined",
      nativePending: false,
    });
    const epoch = committed.epoch;
    await expect(
      ensureMatrixParticipation(actor, bindingId)
    ).resolves.toMatchObject({
      status: "joined",
      room: { id: bindingId, epoch },
    });
    expect(boundary.request).not.toHaveBeenCalled();
    expect(committed.epoch).toBe(epoch);
  });
  it("does not retry provider effects before the stored retry time", async () => {
    pendingIntent();
    committed.due = false;
    await expect(ensureMatrixParticipation(actor, bindingId)).resolves.toEqual({
      status: "pending",
      id: bindingId,
      retryAfterMs: 30000,
    });
    expect(boundary.request).not.toHaveBeenCalled();
  });
  it("denies a binding revoked between preparation and completion before native effects", async () => {
    afterPrepare = () => {
      activeBinding = false;
    };
    await expect(ensureMatrixParticipation(actor, bindingId)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(committed.members.get(actor.userId)?.nativePending).toBe(true);
    expect(boundary.request).not.toHaveBeenCalled();
  });
  it("withdraws a scheduled intent when the human account no longer exists", async () => {
    pendingIntent();
    accountLive = false;
    await expect(
      completeMatrixGroupJoin(bindingId, actor.userId)
    ).resolves.toBe(false);
    expect(committed.members.get(actor.userId)).toEqual({
      state: "removed",
      nativePending: false,
    });
    // Existing retirement may verify native absence; it must not enroll again.
    expect(
      boundary.request.mock.calls.every(
        ([method, path]) =>
          method === "GET" && path.includes("/state/m.room.member/")
      )
    ).toBe(true);
  });
  it("orders organization, room and live authority separately in preparation and foreground completion", async () => {
    await ensureMatrixParticipation(actor, bindingId);
    const committedAt = trace.indexOf("commit:1");
    const providerAt = trace.findIndex((event) => event.startsWith("native:"));
    for (const phase of [
      trace.slice(0, committedAt),
      trace.slice(committedAt + 1, providerAt),
    ]) {
      expect(phase.indexOf("org-share")).toBeGreaterThanOrEqual(0);
      expect(phase.indexOf("room-fence")).toBeGreaterThan(
        phase.indexOf("org-share")
      );
      expect(phase.indexOf("live-member")).toBeGreaterThan(
        phase.indexOf("room-fence")
      );
      expect(phase).toContain("current-session");
    }
  });
  it("advances terminal native retry time so a later due intent can use the bounded poll budget", async () => {
    pendingIntent();
    const laterUser = "better-auth:later-participation-member";
    committed.members.set(laterUser, { state: "joined", nativePending: true });
    committed.identities.set(
      laterUser,
      matrixIdentityForUser(laterUser, "participation.invalid").matrixId
    );
    committed.retryTimes.set(actor.userId, 0);
    committed.retryTimes.set(laterUser, 1);
    now = 2;
    nativeState = "ban";
    await expect(pendingMatrixGroupJoins(1)).resolves.toEqual([
      { bindingId, userId: actor.userId },
    ]);
    await expect(
      completeMatrixGroupJoin(bindingId, actor.userId)
    ).rejects.toMatchObject({ reason: "forbidden" });
    expect(committed.retryTimes.get(actor.userId)).toBe(60002);
    expect(committed.members.get(actor.userId)?.nativePending).toBe(true);
    await expect(pendingMatrixGroupJoins(1)).resolves.toEqual([
      { bindingId, userId: laterUser },
    ]);
    now = 60003;
    committed.due = true;
    boundary.request.mockClear();
    await expect(
      completeMatrixGroupJoin(bindingId, actor.userId)
    ).rejects.toMatchObject({ reason: "forbidden" });
    expect(
      boundary.request.mock.calls.some(
        ([method, path]) => method === "POST" && path.startsWith("join/")
      )
    ).toBe(false);
  });

  it("exports only bounded due join candidates for the existing poll budget", async () => {
    pendingIntent();
    await expect(pendingMatrixGroupJoins(0)).resolves.toEqual([]);
    await expect(pendingMatrixGroupJoins(2)).resolves.toEqual([
      { bindingId, userId: actor.userId },
    ]);
    await expect(pendingMatrixGroupJoins(11)).rejects.toThrow(
      "Expected a join budget from 0 to 10."
    );
    expect(statements.at(-1)).toContain("state = 'joined'");
    expect(statements.at(-1)).toContain("native_retry_at <= clock_timestamp()");
    expect(boundary.request).not.toHaveBeenCalled();
  });
});

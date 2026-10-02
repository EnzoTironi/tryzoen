import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { SqlError } from "@db/queries";
import { createAgentMemberTable } from "../../tests/helpers/agent-members";
import { withSignal } from "../operations/async";
import { WorkspaceAccessDenied } from "./access";
import {
  ExternalAgentMemberSchema,
  ExternalAgentRegistrationSchema,
  ExternalAgentListSchema,
  ExternalAgentMemberError,
  registerExternalAgentMember,
  listExternalAgentMembers,
} from "./agent-members";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  transaction: vi.fn<(run: () => Promise<unknown>) => Promise<unknown>>(),
}));
vi.mock("@db/queries", () => ({
  ...mocks,
  SqlError: class MockSqlError extends Error {
    constructor(cause: unknown) {
      super("Database operation failed", { cause });
    }
  },
}));
const database = new PGlite();
const transactions = new AsyncLocalStorage<{ query: PGlite["query"] }>();
const dialect = new PgDialect();
const actor = {
  userId: "better-auth:manager",
  workspaceId: "workspace",
  authSessionId: "manager-session",
};
const human = {
  ...actor,
  userId: "better-auth:human",
  authSessionId: "human-session",
};
const registration = () => ({
  operationId: randomUUID(),
  username: "helper",
  name: "External helper",
});
const rawQuery = async (statement: SQL) => {
  const compiled = dialect.sqlToQuery(statement);
  try {
    return (
      await (transactions.getStore() ?? database).query<
        Record<string, unknown>
      >(compiled.sql, compiled.params)
    ).rows;
  } catch (cause) {
    throw new SqlError(cause);
  }
};

beforeAll(async () => {
  await database.exec(`
    CREATE TABLE workspaces(id text PRIMARY KEY, organization_id text);
    CREATE TABLE workspace_memberships(workspace_id text,user_id text,role text,PRIMARY KEY(workspace_id,user_id));
    CREATE TABLE organization_memberships(organization_id text,user_id text,PRIMARY KEY(organization_id,user_id));
    CREATE TABLE public.session(id text PRIMARY KEY,"userId" text,"expiresAt" timestamptz);
    CREATE TABLE user_directory(user_id text,username text PRIMARY KEY,kind text);
    CREATE TABLE workspace_bots(id uuid DEFAULT gen_random_uuid(),workspace_id text,username text);
  `);
  await createAgentMemberTable(database);
}, 20000);
beforeEach(async () => {
  await database.exec(`
    TRUNCATE workspace_agent_members, workspace_memberships, organization_memberships, public.session, user_directory, workspace_bots;
    INSERT INTO workspaces VALUES ('workspace','org'),('other','other-org') ON CONFLICT DO NOTHING;
    INSERT INTO workspace_memberships VALUES ('workspace','better-auth:manager','admin'),('workspace','better-auth:human','member'),('other','better-auth:manager','admin');
    INSERT INTO organization_memberships VALUES ('org','better-auth:manager'),('org','better-auth:human'),('other-org','better-auth:manager');
    INSERT INTO public.session VALUES ('manager-session','manager',now()+interval '1 hour'),('human-session','human',now()+interval '1 hour');
  `);
  mocks.query.mockReset().mockImplementation(rawQuery);
  mocks.transaction
    .mockReset()
    .mockImplementation((run) =>
      database.transaction((tx) => transactions.run(tx, run))
    );
});
afterAll(() => database.close());

it("registers a server-generated principal with immutable audit sponsor and a canonical receipt", async () => {
  const input = { ...registration(), name: "  External helper  " };
  const result = await registerExternalAgentMember(actor, input);
  expect(result.applied).toBe(true);
  expect(result.member).toMatchObject({
    workspaceId: actor.workspaceId,
    name: "External helper",
    description: "",
    createdBy: actor.userId,
    status: "registered",
    revokedAt: null,
  });
  expect(result.member.id).not.toBe(input.operationId);
  expect(result.member.principal).toBe(`agent:${result.member.id}`);
  expect(ExternalAgentMemberSchema.safeParse(result.member).success).toBe(true);
  expect(Object.keys(result.member).toSorted()).toEqual(
    [
      "id",
      "workspaceId",
      "username",
      "name",
      "description",
      "createdBy",
      "createdAt",
      "revokedAt",
      "principal",
      "status",
    ].toSorted()
  );
  const stored = (
    await database.query<{ registration_request_hash: string }>(
      "SELECT registration_request_hash FROM workspace_agent_members"
    )
  ).rows[0];
  expect(stored?.registration_request_hash).toBe(
    createHash("sha256")
      .update(
        JSON.stringify([
          1,
          actor.workspaceId,
          actor.userId,
          input.username,
          "External helper",
          "",
        ])
      )
      .digest("hex")
  );
  expect(
    mocks.query.mock.calls
      .map(([statement]) => dialect.sqlToQuery(statement).sql)
      .join("\n")
  ).not.toMatch(/INSERT INTO (matrix_|workspace_agent_grants)|UPDATE|DELETE/u);
});
it("makes concurrent and lost-response retries return one member without reapplying", async () => {
  const input = registration();
  const results = await Promise.all([
    registerExternalAgentMember(actor, input),
    registerExternalAgentMember(actor, input),
  ]);
  expect(
    results
      .map((result) => result.applied)
      .toSorted((left, right) => Number(left) - Number(right))
  ).toEqual([false, true]);
  expect(results[0].member.id).toBe(results[1].member.id);
  expect(await registerExternalAgentMember(actor, input)).toEqual({
    applied: false,
    member: results[0].member,
  });
  expect(
    (await database.query("SELECT id FROM workspace_agent_members")).rows
  ).toHaveLength(1);
});
it("rejects changed content under the same receipt and never revives a revoked replay", async () => {
  const input = registration();
  const original = await registerExternalAgentMember(actor, input);
  await expect(
    registerExternalAgentMember(actor, { ...input, name: "Changed" })
  ).rejects.toMatchObject({ code: "conflict" });
  await database.query(
    "UPDATE workspace_agent_members SET revoked_at=now() WHERE id=$1",
    [original.member.id]
  );
  expect(await registerExternalAgentMember(actor, input)).toMatchObject({
    applied: false,
    member: { id: original.member.id, status: "revoked" },
  });
});
it("handles an insert race by reading the winning receipt", async () => {
  const input = registration();
  const original = await registerExternalAgentMember(actor, input);
  let firstReceipt = true;
  mocks.query.mockImplementation(async (statement) => {
    if (
      firstReceipt &&
      dialect.sqlToQuery(statement).sql.includes("registration_request_hash AS")
    ) {
      firstReceipt = false;
      return [];
    }
    return rawQuery(statement);
  });
  expect(await registerExternalAgentMember(actor, input)).toEqual({
    applied: false,
    member: original.member,
  });
});
it.each([
  "admin",
  "administrator",
  "support",
  "security",
  "zoen",
  "system",
  "everyone",
  "executor",
  "api",
  "root",
])("refuses reserved username %s", async (username) => {
  await expect(
    registerExternalAgentMember(actor, { ...registration(), username })
  ).rejects.toMatchObject({ code: "invalid_input" });
  expect(mocks.query).not.toHaveBeenCalled();
});
it.each(["id", "workspaceId", "createdBy", "grant", "token", "connected"])(
  "rejects caller-controlled %s",
  async (field) => {
    const input = { ...registration(), [field]: "spoofed" };
    await expect(
      registerExternalAgentMember(actor, input)
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(mocks.query).not.toHaveBeenCalled();
  }
);
it.each([
  { username: "HELPER" },
  { username: "ab" },
  { name: " " },
  { name: "x".repeat(61) },
  { description: "x".repeat(241) },
  { operationId: "invalid" },
])("rejects invalid registration %j", async (patch) => {
  await expect(
    registerExternalAgentMember(actor, { ...registration(), ...patch })
  ).rejects.toMatchObject({ code: "invalid_input" });
  expect(mocks.query).not.toHaveBeenCalled();
});
it.each([
  "channelIdentityId",
  "matrixIdentityId",
  "agentGrantId",
  "protocolTaskId",
  "scheduledRunId",
  "scheduledRunLeaseToken",
  "groupBindingId",
  "groupEpoch",
])("denies %s before any lookup", async (field) => {
  const delegated = { ...actor, [field]: randomUUID() };
  await expect(
    registerExternalAgentMember(delegated, registration())
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(listExternalAgentMembers(delegated, {})).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("denies a missing session before any lookup", async () => {
  const anonymous = { userId: actor.userId, workspaceId: actor.workspaceId };
  await expect(
    registerExternalAgentMember(anonymous, registration())
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(mocks.query).not.toHaveBeenCalled();
});
it.each(["membership", "organization", "session", "manager role"])(
  "rechecks current %s on replay",
  async (condition) => {
    const input = registration();
    await registerExternalAgentMember(actor, input);
    if (condition === "membership")
      await database.exec(
        "DELETE FROM workspace_memberships WHERE workspace_id='workspace' AND user_id='better-auth:manager'"
      );
    if (condition === "organization")
      await database.exec(
        "DELETE FROM organization_memberships WHERE organization_id='org' AND user_id='better-auth:manager'"
      );
    if (condition === "session")
      await database.exec(
        "UPDATE public.session SET \"expiresAt\"=now()-interval '1 second'"
      );
    if (condition === "manager role")
      await database.exec(
        "UPDATE workspace_memberships SET role='member' WHERE user_id='better-auth:manager'"
      );
    await expect(
      registerExternalAgentMember(actor, input)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }
);
it("isolates receipt keys and human-handle collisions by workspace", async () => {
  await database.exec(
    "INSERT INTO user_directory VALUES ('human','helper','person')"
  );
  await expect(
    registerExternalAgentMember(actor, registration())
  ).rejects.toMatchObject({ code: "conflict" });
  const other = { ...actor, workspaceId: "other" };
  const input = registration();
  const result = await registerExternalAgentMember(other, input);
  expect(result.member.workspaceId).toBe("other");
  expect(await listExternalAgentMembers(actor, {})).toEqual({
    members: [],
    nextCursor: null,
  });
  await database.exec("DELETE FROM user_directory");
  const local = await registerExternalAgentMember(actor, input);
  expect(local.member.id).not.toBe(result.member.id);
});
it("refuses directory bot names, local hosted-bot names and a second member's handle", async () => {
  await database.exec(
    "INSERT INTO user_directory VALUES (NULL,'catalog_bot','bot'); INSERT INTO workspace_bots(workspace_id,username) VALUES ('workspace','hosted_bot')"
  );
  for (const username of ["catalog_bot", "hosted_bot"])
    await expect(
      registerExternalAgentMember(actor, { ...registration(), username })
    ).rejects.toMatchObject({ code: "conflict" });
  await registerExternalAgentMember(actor, registration());
  await expect(
    registerExternalAgentMember(actor, registration())
  ).rejects.toMatchObject({ code: "conflict" });
});
it("lists bounded UUID pages for ordinary human members including revoked audit status", async () => {
  for (let i = 0; i < 3; i++)
    await registerExternalAgentMember(actor, {
      ...registration(),
      username: `helper_${i}`,
    });
  await database.exec(
    "UPDATE workspace_agent_members SET revoked_at=now() WHERE username='helper_1'"
  );
  const first = await listExternalAgentMembers(human, { limit: 2 });
  const last = await listExternalAgentMembers(human, {
    limit: 2,
    cursor: first.nextCursor ?? undefined,
  });
  expect(first.members).toHaveLength(2);
  expect(last.members).toHaveLength(1);
  expect(last.nextCursor).toBeNull();
  expect(
    new Set([...first.members, ...last.members].map((member) => member.id)).size
  ).toBe(3);
  expect(
    [...first.members, ...last.members].find(
      (member) => member.username === "helper_1"
    )?.status
  ).toBe("revoked");
  await expect(
    registerExternalAgentMember(human, registration())
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});
it.each([
  { limit: 0 },
  { limit: 101 },
  { limit: 1.5 },
  { cursor: "bad" },
  { workspaceId: "other" },
])("rejects invalid list input %j", async (input) => {
  expect(ExternalAgentListSchema.safeParse(input).success).toBe(false);
  await expect(listExternalAgentMembers(actor, input)).rejects.toMatchObject({
    code: "invalid_input",
  });
  expect(mocks.query).not.toHaveBeenCalled();
});
it("enforces the authored SQL constraints and sponsor deletion does not define identity", async () => {
  const input = registration();
  const original = await registerExternalAgentMember(actor, input);
  for (const [column, value] of [
    ["username", "BAD"],
    ["name", " "],
    ["name", " x "],
    ["name", "x".repeat(61)],
    ["description", "x".repeat(241)],
    ["registration_request_hash", "A".repeat(64)],
    ["revoked_at", "2000-01-01"],
  ] as const) {
    await expect(
      database.query(
        `UPDATE workspace_agent_members SET ${column}=$1 WHERE id=$2`,
        [value, original.member.id]
      )
    ).rejects.toBeDefined();
  }
  await database.exec(
    "DELETE FROM workspace_memberships WHERE user_id='better-auth:manager'"
  );
  expect(
    (
      await database.query<{ id: string }>(
        "SELECT id FROM workspace_agent_members"
      )
    ).rows[0]?.id
  ).toBe(original.member.id);
  expect(
    ExternalAgentRegistrationSchema.safeParse({
      ...input,
      principal: original.member.principal,
    }).success
  ).toBe(false);
});
it("translates database failures but preserves permission and cancellation errors", async () => {
  mocks.query.mockRejectedValueOnce(new SqlError(new Error("offline")));
  await expect(listExternalAgentMembers(actor, {})).rejects.toBeInstanceOf(
    ExternalAgentMemberError
  );
  const denied = new WorkspaceAccessDenied();
  mocks.query.mockRejectedValueOnce(denied);
  await expect(listExternalAgentMembers(actor, {})).rejects.toBe(denied);
  const controller = new AbortController();
  const cancelled = new Error("cancelled");
  controller.abort(cancelled);
  await expect(
    withSignal(controller.signal, () => listExternalAgentMembers(actor, {}))
  ).rejects.toBe(cancelled);
});

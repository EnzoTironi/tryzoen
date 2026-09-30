import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { SqlError } from "@db/queries";
import {
  requireWorkspaceAccess,
  workspaceActorFromPrincipal,
  WorkspaceAccessDenied,
} from "./access";
import {
  AgentGrantInputSchema,
  issueAgentGrant,
  authenticateAgentGrant,
  readAgentGrantCapabilities,
} from "./bots";
import { registerExternalAgentMember } from "./agent-members";
import { revokeExternalAgentMember } from "./agent-member-revocation";
import { PrivateMemoryRepository } from "../memory/repository";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  transaction: vi.fn<(run: () => Promise<unknown>) => Promise<unknown>>(),
}));
vi.mock("@db/queries", () => ({
  ...mocks,
  SqlError: class extends Error {
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
const botId = randomUUID();
const otherBotId = randomUUID();
const grantInput = {
  label: "Synthetic external caller",
  capabilities: ["files" as const],
  days: 1,
};
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
    CREATE TABLE workspace_bots(id uuid PRIMARY KEY,workspace_id text,username text,name text,description text,discoverable boolean);
    CREATE TABLE workspace_agent_grants(id uuid PRIMARY KEY,bot_id uuid,issued_by text,label text,token_hash text UNIQUE,capabilities jsonb,expires_at timestamptz,revoked_at timestamptz,
      requester_user_id text,source_workspace_id text,network_kind text,network_id text,origin_bot_id uuid,created_at timestamptz DEFAULT now());
    CREATE TABLE agent_protocol_tasks(id uuid PRIMARY KEY,grant_id uuid,state text,session_id text,output text,updated_at timestamptz DEFAULT now());
    CREATE TABLE matrix_agent_conversations(grant_id uuid,closed_at timestamptz,room_id text,server_name text,sender_id text,bot_id text);
    CREATE TABLE workspace_group_bindings(id uuid PRIMARY KEY,workspace_id text,channel text,epoch uuid);
    CREATE TABLE matrix_room_members(binding_id uuid,user_id text,state text,native_pending boolean DEFAULT false,native_retry_at timestamptz DEFAULT now(),PRIMARY KEY(binding_id,user_id));
  `);
  await database.exec(
    await readFile(
      new URL(
        "../../db/migrations/0052_network-retirement-outboxes.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  await database.exec(
    await readFile(
      new URL("../../db/migrations/0100_agent-members.sql", import.meta.url),
      "utf8"
    )
  );
}, 20000);
beforeEach(async () => {
  await database.exec(`TRUNCATE workspace_agent_grants, workspace_agent_members, agent_protocol_tasks, agent_protocol_cancellations, matrix_agent_conversations,
    matrix_room_retirements, workspace_group_bindings, matrix_room_members, workspace_memberships, organization_memberships, public.session, user_directory, workspace_bots;
    INSERT INTO workspaces VALUES ('workspace','org'),('other','other-org') ON CONFLICT DO NOTHING;
    INSERT INTO workspace_memberships VALUES ('workspace','better-auth:manager','admin'),('workspace','better-auth:human','member'),('other','better-auth:manager','admin');
    INSERT INTO organization_memberships VALUES ('org','better-auth:manager'),('org','better-auth:human'),('other-org','better-auth:manager');
    INSERT INTO public.session VALUES ('manager-session','manager',now()+interval '1 hour');
    INSERT INTO workspace_bots VALUES ('${botId}','workspace','workspace_bot','Synthetic bot','Synthetic',true),('${otherBotId}','other','other_bot','Other bot','Synthetic',true);`);
  mocks.query.mockReset().mockImplementation(rawQuery);
  mocks.transaction
    .mockReset()
    .mockImplementation((run) =>
      database.transaction((tx) => transactions.run(tx, run))
    );
});
afterAll(() => database.close());
async function member(owner = actor) {
  return (
    await registerExternalAgentMember(owner, {
      operationId: randomUUID(),
      username: "caller_" + randomUUID().slice(0, 8),
      name: "Synthetic caller",
    })
  ).member;
}
async function grant(externalMemberId: string) {
  return issueAgentGrant(actor, { ...grantInput, externalMemberId });
}
async function authenticate(token: string) {
  return (await authenticateAgentGrant("Bearer " + token, "workspace_bot"))
    .actor;
}
async function task(grantId: string, state = "TASK_STATE_WORKING") {
  const id = randomUUID();
  const session = "native:" + id;
  await database.query(
    "INSERT INTO agent_protocol_tasks(id,grant_id,state,session_id) VALUES ($1,$2,$3,$4)",
    [id, grantId, state, session]
  );
  return { id, session };
}

it("requires a named caller subject and refuses unbound historical bearer impersonation", async () => {
  expect(AgentGrantInputSchema.safeParse(grantInput).success).toBe(false);
  const token = "zoen_a2a_" + "a".repeat(43);
  await database.query(
    "INSERT INTO workspace_agent_grants(id,bot_id,issued_by,label,token_hash,capabilities,expires_at) VALUES ($1,$2,$3,'Unbound',$4,'[\"files\"]',now()+interval '1 day')",
    [
      randomUUID(),
      botId,
      actor.userId,
      createHash("sha256").update(token).digest("hex"),
    ]
  );
  await expect(authenticate(token)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
});
it("keeps multiple grants on one stable service identity without inheriting the issuer", async () => {
  const caller = await member();
  const first = await grant(caller.id);
  const second = await grant(caller.id);
  const access = await authenticate(first.token);
  expect(access).toMatchObject({
    userId: caller.principal,
    role: "member",
    workspaceId: actor.workspaceId,
    agentGrantId: first.id,
  });
  expect(access.userId).not.toBe(actor.userId);
  expect((await authenticate(second.token)).userId).toBe(access.userId);
  expect(await readAgentGrantCapabilities(access)).toEqual(["files"]);
  await expect(requireWorkspaceAccess(access, true)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
  await expect(PrivateMemoryRepository.read(access)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
});
it("rejects spoofed subject, mixed auth, foreign workspace and issuer reuse of a member grant", async () => {
  const caller = await member();
  const key = await grant(caller.id);
  const access = await authenticate(key.token);
  for (const override of [
    { userId: "agent:" + randomUUID() },
    { workspaceId: "other" },
    { userId: actor.userId },
    { authSessionId: actor.authSessionId },
    { groupBindingId: randomUUID() },
  ])
    await expect(
      requireWorkspaceAccess({ ...access, ...override })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});
it.each(["membership", "organization", "role"])(
  "rechecks the issuer's current %s without rebinding to another human",
  async (change) => {
    const caller = await member();
    const key = await grant(caller.id);
    await authenticate(key.token);
    if (change === "membership")
      await database.exec(
        "DELETE FROM workspace_memberships WHERE user_id='better-auth:manager' AND workspace_id='workspace'"
      );
    else if (change === "organization")
      await database.exec(
        "DELETE FROM organization_memberships WHERE user_id='better-auth:manager' AND organization_id='org'"
      );
    else
      await database.exec(
        "UPDATE workspace_memberships SET role='member' WHERE user_id='better-auth:manager' AND workspace_id='workspace'"
      );
    await expect(authenticate(key.token)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
  }
);
it("uses a service principal only for bound A2A authentication and keeps human sessions working", async () => {
  const caller = await member();
  const key = await grant(caller.id);
  const principal = {
    principalType: "service" as const,
    principalId: caller.principal,
    authenticator: "a2a",
    attributes: { workspaceId: actor.workspaceId, agentGrantId: key.id },
  };
  expect((await workspaceActorFromPrincipal(principal)).userId).toBe(
    caller.principal
  );
  for (const bad of [
    { ...principal, principalType: "user" as const },
    { ...principal, authenticator: "authjs" },
    { ...principal, principalId: actor.userId },
  ])
    await expect(workspaceActorFromPrincipal(bad)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
  expect(
    (
      await workspaceActorFromPrincipal({
        principalType: "user",
        principalId: actor.userId,
        authenticator: "authjs",
        attributes: {
          workspaceId: actor.workspaceId,
          authSessionId: actor.authSessionId,
        },
      })
    ).role
  ).toBe("admin");
});
it("fences exact task/grant/state for service continuation", async () => {
  const caller = await member();
  const key = await grant(caller.id);
  const other = await grant(caller.id);
  const access = await authenticate(key.token);
  const own = await task(key.id);
  const foreign = await task(other.id);
  const parked = await task(key.id, "TASK_STATE_INPUT_REQUIRED");
  expect(
    (await requireWorkspaceAccess({ ...access, protocolTaskId: own.id }))
      .protocolTaskId
  ).toBe(own.id);
  for (const id of [foreign.id, parked.id, randomUUID()])
    await expect(
      requireWorkspaceAccess({ ...access, protocolTaskId: id })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});
it("rotates only the selected subject-bound grant and preserves old task binding/cancellation", async () => {
  const caller = await member();
  const first = await grant(caller.id);
  const other = await grant(caller.id);
  const running = await task(first.id);
  const unrelated = await task(other.id);
  const replacement = await issueAgentGrant(actor, {
    ...grantInput,
    externalMemberId: caller.id,
    replacesGrantId: first.id,
  });
  expect((await authenticate(replacement.token)).userId).toBe(caller.principal);
  await expect(authenticate(first.token)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
  await authenticate(other.token);
  const old = (
    await database.query(
      "SELECT grant_id,state FROM agent_protocol_tasks WHERE id=$1",
      [running.id]
    )
  ).rows[0];
  expect(old).toEqual({ grant_id: first.id, state: "TASK_STATE_CANCELED" });
  expect(
    (
      await database.query(
        "SELECT state FROM agent_protocol_tasks WHERE id=$1",
        [unrelated.id]
      )
    ).rows[0]
  ).toEqual({ state: "TASK_STATE_WORKING" });
  expect(
    (
      await database.query(
        "SELECT session_id FROM agent_protocol_cancellations"
      )
    ).rows
  ).toEqual([{ session_id: running.session }]);
});
it("rolls back a cross-subject rotation and denies cross-workspace or revoked members", async () => {
  const first = await member();
  const second = await member();
  const key = await grant(first.id);
  await expect(
    issueAgentGrant(actor, {
      ...grantInput,
      externalMemberId: second.id,
      replacesGrantId: key.id,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await authenticate(key.token);
  const foreign = await member({ ...actor, workspaceId: "other" });
  await expect(grant(foreign.id)).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await revokeExternalAgentMember(actor, second.id);
  await expect(grant(second.id)).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});
it("atomically revokes all member grants/tasks and schedules existing room retirement without native I/O", async () => {
  const caller = await member();
  const first = await grant(caller.id);
  const second = await grant(caller.id);
  const other = await member();
  const otherKey = await grant(other.id);
  const working = await task(first.id);
  const parked = await task(second.id, "TASK_STATE_INPUT_REQUIRED");
  const room = randomUUID();
  const epoch = randomUUID();
  await database.query(
    "INSERT INTO workspace_group_bindings VALUES ($1,'workspace','matrix',$2)",
    [room, epoch]
  );
  await database.query(
    "INSERT INTO matrix_room_members(binding_id,user_id,state) VALUES ($1,$2,'joined'),($1,$3,'joined')",
    [room, caller.principal, other.principal]
  );
  expect(await revokeExternalAgentMember(actor, caller.id)).toEqual({
    revoked: true,
  });
  expect(await revokeExternalAgentMember(actor, caller.id)).toEqual({
    revoked: true,
  });
  for (const key of [first, second])
    await expect(authenticate(key.token)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
  await authenticate(otherKey.token);
  expect(
    (await database.query("SELECT state FROM agent_protocol_tasks ORDER BY id"))
      .rows
  ).toEqual([
    { state: "TASK_STATE_CANCELED" },
    { state: "TASK_STATE_CANCELED" },
  ]);
  expect(
    (
      await database.query(
        "SELECT session_id FROM agent_protocol_cancellations ORDER BY session_id"
      )
    ).rows
  ).toEqual(
    [working.session, parked.session]
      .toSorted()
      .map((session_id) => ({ session_id }))
  );
  const ownRoom = (
    await database.query(
      "SELECT state,native_pending FROM matrix_room_members WHERE user_id=$1",
      [caller.principal]
    )
  ).rows[0];
  expect(ownRoom).toEqual({ state: "removed", native_pending: true });
  expect(
    (
      await database.query<{ epoch: string }>(
        "SELECT epoch FROM workspace_group_bindings WHERE id=$1",
        [room]
      )
    ).rows[0]?.epoch
  ).not.toBe(epoch);
  expect(
    (
      await database.query(
        "SELECT state,native_pending FROM matrix_room_members WHERE user_id=$1",
        [other.principal]
      )
    ).rows[0]
  ).toEqual({ state: "joined", native_pending: false });
});
it("rolls back member/grant/task fences together if room retirement cannot be recorded", async () => {
  const caller = await member();
  const key = await grant(caller.id);
  const running = await task(key.id);
  mocks.query.mockImplementation(async (statement) => {
    if (dialect.sqlToQuery(statement).sql.includes("WITH retired"))
      throw new SqlError(new Error("Injected write failure"));
    return rawQuery(statement);
  });
  await expect(
    revokeExternalAgentMember(actor, caller.id)
  ).rejects.toBeInstanceOf(SqlError);
  mocks.query.mockImplementation(rawQuery);
  await authenticate(key.token);
  expect(
    (
      await database.query(
        "SELECT state FROM agent_protocol_tasks WHERE id=$1",
        [running.id]
      )
    ).rows[0]
  ).toEqual({ state: "TASK_STATE_WORKING" });
  expect(
    (await database.query("SELECT * FROM agent_protocol_cancellations")).rows
  ).toEqual([]);
});
it("enforces same-workspace and immutable subject/registration fences in authored SQL", async () => {
  const caller = await member();
  const other = await member();
  const key = await grant(caller.id);
  for (const [column, value] of [
    ["external_member_id", other.id],
    ["bot_id", otherBotId],
    ["issued_by", "better-auth:human"],
  ] as const)
    await expect(
      database.query(
        `UPDATE workspace_agent_grants SET ${column}=$1 WHERE id=$2`,
        [value, key.id]
      )
    ).rejects.toMatchObject({ code: "23514" });
  await expect(
    database.query(
      "UPDATE workspace_agent_members SET workspace_id='other' WHERE id=$1",
      [caller.id]
    )
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    database.query(
      "UPDATE workspace_agent_grants SET requester_user_id='better-auth:human' WHERE id=$1",
      [key.id]
    )
  ).rejects.toMatchObject({ code: "23514" });
  const foreign = await member({ ...actor, workspaceId: "other" });
  await expect(
    database.query(
      "INSERT INTO workspace_agent_grants(id,bot_id,issued_by,external_member_id,label,token_hash,capabilities,expires_at) VALUES ($1,$2,$3,$4,'Foreign','foreign-key','[\"files\"]',now()+interval '1 day')",
      [randomUUID(), botId, actor.userId, foreign.id]
    )
  ).rejects.toMatchObject({ code: "23514" });
  await revokeExternalAgentMember(actor, caller.id);
  await expect(
    database.query(
      "UPDATE workspace_agent_members SET revoked_at=NULL WHERE id=$1",
      [caller.id]
    )
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    database.query(
      "UPDATE workspace_agent_grants SET revoked_at=NULL WHERE id=$1",
      [key.id]
    )
  ).rejects.toMatchObject({ code: "23514" });
});
it("preserves the verified human Matrix-network grant without giving it a service subject", async () => {
  const grantId = randomUUID();
  await database.query(
    "INSERT INTO workspace_agent_grants(id,bot_id,issued_by,requester_user_id,source_workspace_id,network_kind,network_id,label,token_hash,capabilities,expires_at) VALUES ($1,$2,$3,'better-auth:human','workspace','company','org','Human network','human-network-key','[\"files\"]',now()+interval '1 day')",
    [grantId, botId, actor.userId]
  );
  expect(
    (
      await requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        agentGrantId: grantId,
      })
    ).userId
  ).toBe(actor.userId);
  await expect(
    requireWorkspaceAccess({
      userId: "agent:" + randomUUID(),
      workspaceId: actor.workspaceId,
      agentGrantId: grantId,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

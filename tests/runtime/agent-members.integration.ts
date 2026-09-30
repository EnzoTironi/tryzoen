import { randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { parseInputResponses, type InputRequest } from "eve/client";
import type { AttachSessionFn } from "eve/channels";
import {
  type ExternalAgentMemberError,
  listExternalAgentMembers,
  registerExternalAgentMember,
} from "../../server/workspaces/agent-members";
import {
  requireWorkspaceAccess,
  workspaceActorFromPrincipal,
  WorkspaceAccessDenied,
} from "../../server/workspaces/access";
import {
  authenticateAgentGrant,
  readAgentGrantCapabilities,
  revokeAgentGrant,
} from "../../server/workspaces/bots";
import { revokeExternalAgentMember } from "../../server/workspaces/agent-member-revocation";
import {
  acceptProtocolTask,
  A2AError,
  bindProtocolSession,
  protocolInputReceiptId,
  readProtocolTask,
} from "../../server/a2a/tasks";
import { recoverableProtocolActor } from "../../server/a2a/delivery";
import {
  deliverProtocolInput,
  projectProtocolInputs,
  protocolInputContext,
  respondProtocolInput,
} from "../../server/a2a/inputs";
import { channelConsentRevision } from "../../agent/lib/channel-consent";
import { readNativeReceipt } from "../../server/messaging/native-receipts";
import { requireMatrixRoom } from "../../server/matrix/rooms";
import { readRoomMembers } from "../../server/matrix/members";
import { resolveMatrixMentions } from "../../server/matrix/mentions";
import { agentMemberFixture, agentPrincipalFor } from "./agent-member-fixture";

const registration = (username = "fixture_agent") => ({
  operationId: randomUUID(),
  username,
  name: "Synthetic external agent",
});
const message = (messageId: string = randomUUID()) => ({
  message: {
    messageId,
    role: "ROLE_USER" as const,
    parts: [{ text: "Isolated fixture task" }],
  },
});
const question: InputRequest = {
  requestId: "fixture-question",
  kind: "question",
  prompt: "Which release day?",
  options: [{ id: "friday", label: "Friday" }],
  allowFreeform: false,
  action: {
    kind: "tool-call",
    callId: "fixture-question-call",
    toolName: "ask_question",
    input: { prompt: "Which release day?" },
  },
};

test("concurrent registration replay keeps one server-generated member; conflicting payload never mutates it", async () => {
  await using fixture = await agentMemberFixture();
  const input = registration();
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      registerExternalAgentMember(fixture.actor, input)
    )
  );
  expect(results.filter((result) => result.applied)).toHaveLength(1);
  expect(new Set(results.map((result) => result.member.id)).size).toBe(1);
  const member = results[0]?.member;
  if (!member) throw new Error("Registration returned no member");
  expect(member.id).not.toBe(input.operationId);
  expect(member.principal).toBe(`agent:${member.id}`);
  await expect(
    registerExternalAgentMember(fixture.actor, {
      ...input,
      name: "Changed payload",
    })
  ).rejects.toMatchObject({
    code: "conflict",
  } satisfies Partial<ExternalAgentMemberError>);
  expect((await listExternalAgentMembers(fixture.actor, {})).members).toEqual([
    member,
  ]);
});

test("members have distinct service identities without human membership, native connectivity or grants", async () => {
  await using fixture = await agentMemberFixture();
  await using outside = await agentMemberFixture();
  const first = (
    await registerExternalAgentMember(fixture.actor, registration())
  ).member;
  const second = (
    await registerExternalAgentMember(
      fixture.actor,
      registration("fixture_other")
    )
  ).member;
  const foreign = (
    await registerExternalAgentMember(outside.actor, registration())
  ).member;
  expect(
    new Set([first.principal, second.principal, foreign.principal]).size
  ).toBe(3);
  expect(first.createdBy).toBe(fixture.actor.userId);
  expect(first.status).toBe("registered");
  const page = await listExternalAgentMembers(fixture.guest, { limit: 1 });
  expect(page.members).toHaveLength(1);
  expect(page.nextCursor).toBe(page.members[0]?.id);
  const next = await listExternalAgentMembers(fixture.guest, {
    cursor: page.nextCursor ?? undefined,
    limit: 1,
  });
  expect(
    new Set([...page.members, ...next.members].map((member) => member.id))
  ).toEqual(new Set([first.id, second.id]));
  expect(next.nextCursor).toBeNull();
  expect(
    await query(
      sql`SELECT user_id FROM workspace_memberships WHERE user_id IN (${first.principal}, ${second.principal})`
    )
  ).toEqual([]);
  expect(
    await query(
      sql`SELECT user_id FROM matrix_identities WHERE user_id IN (${first.principal}, ${second.principal})`
    )
  ).toEqual([]);
  expect(
    await query(
      sql`SELECT id FROM workspace_agent_grants WHERE external_member_id IN (${first.id}, ${second.id})`
    )
  ).toEqual([]);
  await expect(
    listExternalAgentMembers(
      { ...fixture.actor, workspaceId: outside.actor.workspaceId },
      {}
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("registration replay rechecks the current human role and session", async () => {
  await using fixture = await agentMemberFixture();
  const input = registration();
  const original = await registerExternalAgentMember(fixture.actor, input);
  await query(
    sql`UPDATE workspace_memberships SET role = 'member' WHERE workspace_id = ${fixture.actor.workspaceId} AND user_id = ${fixture.actor.userId}`
  );
  await expect(
    registerExternalAgentMember(fixture.actor, input)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect((await listExternalAgentMembers(fixture.actor, {})).members).toEqual([
    original.member,
  ]);
  await query(
    sql`UPDATE public.session SET "expiresAt" = clock_timestamp() - interval '1 second' WHERE id = ${fixture.actor.authSessionId}`
  );
  await expect(
    listExternalAgentMembers(fixture.actor, {})
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("independent grants resolve the same service principal with separate capabilities and no sponsor authority", async () => {
  await using fixture = await agentMemberFixture();
  await using outside = await agentMemberFixture();
  const member = (
    await registerExternalAgentMember(fixture.actor, registration())
  ).member;
  const other = (
    await registerExternalAgentMember(
      fixture.actor,
      registration("fixture_other")
    )
  ).member;
  const files = await fixture.grant(member, ["files"], "files");
  const ontology = await fixture.grant(member, ["ontology"], "ontology");
  const otherGrant = await fixture.grant(other, ["files"], "other");
  expect(files.actor.userId).toBe(member.principal);
  expect(ontology.actor.userId).toBe(member.principal);
  expect(files.actor.role).toBe("member");
  expect(await readAgentGrantCapabilities(files.actor)).toEqual(["files"]);
  expect(await readAgentGrantCapabilities(ontology.actor)).toEqual([
    "ontology",
  ]);
  expect(
    (await workspaceActorFromPrincipal(agentPrincipalFor(files.actor))).userId
  ).toBe(member.principal);
  await expect(
    workspaceActorFromPrincipal({
      ...agentPrincipalFor(files.actor),
      principalType: "user",
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    requireWorkspaceAccess(files.actor, true)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    registerExternalAgentMember(files.actor, registration("forged_member"))
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    requireWorkspaceAccess({ ...files.actor, userId: fixture.actor.userId })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    requireWorkspaceAccess({
      ...files.actor,
      authSessionId: fixture.actor.authSessionId,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    requireWorkspaceAccess({ ...files.actor, agentGrantId: otherGrant.id })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    requireWorkspaceAccess({
      ...files.actor,
      workspaceId: outside.actor.workspaceId,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    authenticateAgentGrant(files.bearer, outside.bot.username)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("database fences prevent cross-workspace grants and immutable identity or grant reassignment", async () => {
  await using fixture = await agentMemberFixture();
  await using outside = await agentMemberFixture();
  const member = (
    await registerExternalAgentMember(fixture.actor, registration())
  ).member;
  const other = (
    await registerExternalAgentMember(
      fixture.actor,
      registration("fixture_other")
    )
  ).member;
  const grant = await fixture.grant(member, ["files"], "files");
  await expect(outside.grant(member, ["files"], "other")).rejects.toMatchObject(
    { cause: { cause: { code: "23514" } } }
  );
  await expect(
    query(
      sql`UPDATE workspace_agent_members SET workspace_id = ${outside.actor.workspaceId} WHERE id = ${member.id}`
    )
  ).rejects.toMatchObject({ cause: { cause: { code: "23514" } } });
  await expect(
    query(
      sql`UPDATE workspace_agent_grants SET external_member_id = ${other.id} WHERE id = ${grant.id}`
    )
  ).rejects.toMatchObject({ cause: { cause: { code: "23514" } } });
  await expect(
    query(
      sql`UPDATE workspace_agent_grants SET bot_id = ${outside.bot.id} WHERE id = ${grant.id}`
    )
  ).rejects.toMatchObject({ cause: { cause: { code: "23514" } } });
  expect(
    (await authenticateAgentGrant(grant.bearer, fixture.bot.username)).actor
      .userId
  ).toBe(member.principal);
  expect(
    (await listExternalAgentMembers(fixture.actor, {})).members.find(
      (entry) => entry.id === member.id
    )?.workspaceId
  ).toBe(fixture.actor.workspaceId);
});

test("room authorization and native mention projections include only current joined members of that room", async () => {
  await using fixture = await agentMemberFixture();
  await using outside = await agentMemberFixture();
  const member = (
    await registerExternalAgentMember(fixture.actor, registration())
  ).member;
  const unjoined = (
    await registerExternalAgentMember(
      fixture.actor,
      registration("fixture_unjoined")
    )
  ).member;
  const grant = await fixture.grant(member, ["files"], "files");
  const room = await fixture.room([member]);
  const otherRoom = await fixture.room([unjoined]);
  const foreignRoom = await outside.room([]);
  const people = await readRoomMembers(fixture.actor, room.id, "group");
  const nativeMember = people.find(
    (person) => person.username === member.username
  );
  expect(nativeMember).toMatchObject({
    name: member.name,
    bot: true,
    mine: false,
    mayRemove: false,
  });
  expect(
    await resolveMatrixMentions(
      fixture.actor,
      room,
      `@${member.username} @${unjoined.username}`
    )
  ).toEqual({ user_ids: [nativeMember?.id] });
  expect(
    await resolveMatrixMentions(fixture.actor, otherRoom, `@${member.username}`)
  ).toEqual({ user_ids: [] });
  await expect(
    requireMatrixRoom(fixture.actor, foreignRoom.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(requireMatrixRoom(grant.actor, room.id)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
  expect(await readRoomMembers(fixture.actor, foreignRoom.id, "group")).toEqual(
    []
  );
  expect(
    await resolveMatrixMentions(
      fixture.actor,
      foreignRoom,
      `@${member.username}`
    )
  ).toEqual({ user_ids: [] });
  await query(
    sql`UPDATE matrix_room_members SET state = 'removed' WHERE binding_id = ${room.id} AND user_id = ${member.principal}`
  );
  expect(
    (await readRoomMembers(fixture.actor, room.id, "group")).some(
      (person) => person.id === nativeMember?.id
    )
  ).toBe(false);
  expect(
    await resolveMatrixMentions(fixture.actor, room, `@${member.username}`)
  ).toEqual({ user_ids: [] });
});

test("revoking one grant fences pending work and stale answers; a replacement never inherits its task or session", async () => {
  await using fixture = await agentMemberFixture();
  const member = (
    await registerExternalAgentMember(fixture.actor, registration())
  ).member;
  const old = await fixture.grant(member, ["files"], "files");
  const independent = await fixture.grant(member, ["ontology"], "ontology");
  const pending = await acceptProtocolTask(old.actor, message());
  expect((await recoverableProtocolActor(pending.id)).userId).toBe(
    member.principal
  );
  const parked = await acceptProtocolTask(old.actor, message());
  const sessionId = fixture.sessionId();
  await bindProtocolSession(old.actor, parked.id, sessionId);
  const auth = agentPrincipalFor(old.actor, parked.id);
  const channel = protocolInputContext(
    { receipts: {} },
    {
      id: sessionId,
      auth: { current: auth, initiator: auth },
      continuation: {
        token: `a2a:${old.id}:${parked.id}`,
        alias: vi.fn<(token: string) => void>(),
      },
    }
  );
  await projectProtocolInputs(channel, [question], channel.session);
  expect((await readProtocolTask(old.actor, parked.id)).state).toBe(
    "TASK_STATE_INPUT_REQUIRED"
  );
  await revokeAgentGrant(fixture.actor, old.id);
  await expect(
    authenticateAgentGrant(old.bearer, fixture.bot.username)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(recoverableProtocolActor(pending.id)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
  expect(await readAgentGrantCapabilities(independent.actor)).toEqual([
    "ontology",
  ]);
  const replacement = await fixture.grant(member, ["files"], "replacement");
  expect(replacement.actor.userId).toBe(member.principal);
  await expect(
    readProtocolTask(replacement.actor, parked.id)
  ).rejects.toBeInstanceOf(A2AError);
  await expect(
    requireWorkspaceAccess({ ...replacement.actor, protocolTaskId: parked.id })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    acceptProtocolTask(replacement.actor, {
      message: { ...message().message, contextId: parked.contextId },
    })
  ).rejects.toMatchObject({ code: -32001 });
  const answer = {
    message: {
      ...message("stale-answer").message,
      taskId: parked.id,
      contextId: parked.contextId,
      parts: [{ text: "Friday" }],
      metadata: {
        zoenInput: {
          requestId: question.requestId,
          revision: channelConsentRevision(question),
        },
      },
    },
  };
  const attach = vi.fn<AttachSessionFn>(() => {
    throw new Error("Stale work must not reach Eve");
  });
  await expect(
    respondProtocolInput(replacement.actor, answer, attach)
  ).rejects.toBeInstanceOf(A2AError);
  expect(attach).not.toHaveBeenCalled();
  const inputId = protocolInputReceiptId(old.id, answer.message.messageId);
  expect(
    await deliverProtocolInput(
      {
        inputResponses: parseInputResponses([
          { requestId: question.requestId, optionId: "friday" },
        ]),
        context: [
          `zoen.delivery:${JSON.stringify({ id: inputId, digest: "f".repeat(64) })}`,
          `zoen.a2a.input:${JSON.stringify({ taskId: parked.id, contextId: parked.contextId, messageId: answer.message.messageId, ...answer.message.metadata.zoenInput })}`,
        ],
      },
      channel
    )
  ).toBeUndefined();
  expect(
    await readNativeReceipt(fixture.actor.workspaceId, inputId)
  ).toBeUndefined();
  const bindings = await query(
    sql`SELECT id, grant_id, session_id, state FROM agent_protocol_tasks WHERE id IN (${pending.id}, ${parked.id}) ORDER BY id`
  );
  expect(bindings).toHaveLength(2);
  expect(
    bindings.every(
      (task) => task.grant_id === old.id && task.state === "TASK_STATE_CANCELED"
    )
  ).toBe(true);
  expect(bindings.find((task) => task.id === parked.id)?.session_id).toBe(
    sessionId
  );
  expect(
    await query(
      sql`SELECT session_id FROM agent_protocol_cancellations WHERE session_id = ${sessionId}`
    )
  ).toEqual([{ session_id: sessionId }]);
  const fresh = await acceptProtocolTask(replacement.actor, message());
  expect(fresh.sessionId).toBeNull();
  expect(fresh.contextId).not.toBe(parked.contextId);
  expect(
    await query(
      sql`SELECT id FROM agent_protocol_tasks WHERE grant_id IN (${old.id}, ${replacement.id})`
    )
  ).toHaveLength(3);
});

test("member revocation atomically retires all its grants, room membership and work while preserving identity and unrelated agents", async () => {
  await using fixture = await agentMemberFixture();
  await using outside = await agentMemberFixture();
  const input = registration();
  const member = (await registerExternalAgentMember(fixture.actor, input))
    .member;
  const other = (
    await registerExternalAgentMember(
      fixture.actor,
      registration("fixture_other")
    )
  ).member;
  const files = await fixture.grant(member, ["files"], "files");
  const ontology = await fixture.grant(member, ["ontology"], "ontology");
  const unrelated = await fixture.grant(other, ["files"], "other");
  const room = await fixture.room([member, other]);
  const first = await acceptProtocolTask(files.actor, message());
  const second = await acceptProtocolTask(ontology.actor, message());
  const sessionId = fixture.sessionId();
  await bindProtocolSession(files.actor, first.id, sessionId);
  await expect(
    revokeExternalAgentMember(fixture.guest, member.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    revokeExternalAgentMember(outside.actor, member.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(await revokeExternalAgentMember(fixture.actor, member.id)).toEqual({
    revoked: true,
  });
  expect(await revokeExternalAgentMember(fixture.actor, member.id)).toEqual({
    revoked: true,
  });
  for (const grant of [files, ontology]) {
    await expect(
      authenticateAgentGrant(grant.bearer, fixture.bot.username)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(requireWorkspaceAccess(grant.actor)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
  }
  expect(
    (await authenticateAgentGrant(unrelated.bearer, fixture.bot.username)).actor
      .userId
  ).toBe(other.principal);
  const replay = await registerExternalAgentMember(fixture.actor, input);
  expect(replay.applied).toBe(false);
  expect(replay.member).toMatchObject({
    id: member.id,
    principal: member.principal,
    createdBy: member.createdBy,
    status: "revoked",
  });
  expect(replay.member.revokedAt).toBeInstanceOf(Date);
  expect(
    await query(
      sql`SELECT id FROM workspace_agent_grants WHERE external_member_id = ${member.id} AND revoked_at IS NULL`
    )
  ).toEqual([]);
  expect(
    await query(
      sql`SELECT id FROM agent_protocol_tasks WHERE id IN (${first.id}, ${second.id}) AND state = 'TASK_STATE_CANCELED'`
    )
  ).toHaveLength(2);
  expect(
    await query(
      sql`SELECT session_id FROM agent_protocol_cancellations WHERE session_id = ${sessionId}`
    )
  ).toEqual([{ session_id: sessionId }]);
  expect(
    await query(
      sql`SELECT state, native_pending FROM matrix_room_members WHERE binding_id = ${room.id} AND user_id = ${member.principal}`
    )
  ).toEqual([{ state: "removed", native_pending: true }]);
  expect((await requireMatrixRoom(fixture.actor, room.id)).epoch).not.toBe(
    room.epoch
  );
  const people = await readRoomMembers(fixture.actor, room.id, "group");
  expect(people.some((person) => person.username === member.username)).toBe(
    false
  );
  const remaining = people.find((person) => person.username === other.username);
  expect(
    await resolveMatrixMentions(
      fixture.actor,
      room,
      `@${member.username} @${other.username}`
    )
  ).toEqual({ user_ids: [remaining?.id] });
  expect(
    await query(
      sql`SELECT user_id FROM matrix_identities WHERE user_id = ${member.principal}`
    )
  ).toEqual([{ user_id: member.principal }]);
  await expect(
    query(
      sql`UPDATE workspace_agent_members SET revoked_at = NULL WHERE id = ${member.id}`
    )
  ).rejects.toMatchObject({ cause: { cause: { code: "23514" } } });
  await expect(
    query(
      sql`UPDATE workspace_agent_grants SET revoked_at = NULL WHERE id = ${files.id}`
    )
  ).rejects.toMatchObject({ cause: { cause: { code: "23514" } } });
});

test("issuer offboarding fences delegated access without replacing the stable agent identity", async () => {
  await using fixture = await agentMemberFixture();
  const member = (
    await registerExternalAgentMember(fixture.actor, registration())
  ).member;
  const files = await fixture.grant(member, ["files"], "files");
  await query(
    sql`UPDATE workspace_memberships SET role = 'member' WHERE workspace_id = ${fixture.actor.workspaceId} AND user_id = ${fixture.actor.userId}`
  );
  await expect(
    authenticateAgentGrant(files.bearer, fixture.bot.username)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    workspaceActorFromPrincipal(agentPrincipalFor(files.actor))
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect((await listExternalAgentMembers(fixture.actor, {})).members).toEqual([
    member,
  ]);
});

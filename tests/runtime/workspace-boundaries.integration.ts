import { onTestFinished } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { SessionAuthContext } from "eve/context";
import { expect, test, vi } from "vitest";
import { ensureScope } from "../../db/services/scope";
import { claimSession } from "../../db/services/sessions";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import { dispatchNativeScheduledReport } from "../../server/schedules/native-report";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  workspaceActorFromPrincipal,
} from "../../server/workspaces/access";
import {
  issueAgentGrant,
  saveWorkspaceBot,
} from "../../server/workspaces/bots";
import { getWorkspaceGoogleToken } from "../../server/workspaces/connections";
import {
  answerWorkspaceInvitation,
  inviteWorkspaceMember,
  readWorkspaceTeam,
  removeWorkspaceMember,
} from "../../server/workspaces/team";
import { scopeFromPrincipal } from "../../shared/identity/principal-scope";
import { linkedIdentity } from "./identity-fixture";
import { workspaceFixture } from "./workspace-fixture";
const chunks = (identityId: string) =>
  query(
    sql<{
      status: string;
      lastError: string | null;
    }>`SELECT status, last_error AS "lastError" FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY sequence`
  );
vi.mock("../../db/services/auth", async () => {
  return {
    getAuth: async () => ({
      $context: Promise.resolve({
        secretConfig: "synthetic-connection-key-for-tests-only",
      }),
    }),
  };
});
const denied = (
  result:
    | {
        ok: true;
        value: unknown;
      }
    | {
        ok: false;
        error: unknown;
      }
) => {
  expect(!result.ok && result.error).toBeInstanceOf(WorkspaceAccessDenied);
};
const emptyWorkspace = async function (
  database: typeof import("drizzle-orm").sql,
  teamWorkspaceId: string
) {
  const id = `team-other-${randomUUID()}`;
  onTestFinished(async () => {
    await query(database`DELETE FROM workspaces WHERE id = ${id}`);
  });
  await query(database`INSERT INTO workspaces (id, organization_id)
    SELECT ${id}::text, organization_id FROM workspaces WHERE id = ${teamWorkspaceId}`);
  return id;
};
const durableAuthority = (
  database: typeof import("drizzle-orm").sql,
  ids: {
    readonly jobId: string;
    readonly grantId: string;
    readonly taskId: string;
    readonly sessionId: string;
  }
) =>
  query(database<{
    job: string | null;
    grantRevoked: boolean | null;
    task: string | null;
    sessions: number;
  }>`SELECT
    (SELECT status FROM scheduled_agent_jobs WHERE id = ${ids.jobId}) AS job,
    (SELECT revoked_at IS NOT NULL FROM workspace_agent_grants WHERE id = ${ids.grantId}) AS "grantRevoked",
    (SELECT state FROM agent_protocol_tasks WHERE id = ${ids.taskId}) AS task,
    (SELECT count(*)::int FROM agent_sessions WHERE session_id = ${ids.sessionId}) AS sessions`);
test("SP08: a copied or edited workspace id grants nothing without a current membership", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal } = workspace;
  const other = await emptyWorkspace(sql, actor.workspaceId);
  denied(
    await Promise.try(async () =>
      requireWorkspaceAccess({
        ...guest,
        workspaceId: other,
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  denied(
    await Promise.try(async () =>
      requireWorkspaceAccess({
        ...actor,
        workspaceId: other,
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  denied(
    await Promise.try(async () =>
      requireWorkspaceAccess({
        ...guest,
        workspaceId: personal.workspaceId,
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  expect((await requireWorkspaceAccess(guest)).role).toBe("member");
  await assert.rejects(
    ensureScope({
      userId: guest.userId,
      workspaceId: other,
    }),
    {
      _tag: "ScopeAccessDenied",
    }
  );
});
test("SP07: a guest reaches only the granted scope and none of its management", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const other = await emptyWorkspace(sql, actor.workspaceId);
  await repository.write(actor, {
    operationId: randomUUID(),
    path: "knowledge/team.md",
    content: "Shared with members",
    expectedRevision: null,
  });
  denied(
    await Promise.try(async () =>
      repository.read({
        ...guest,
        workspaceId: other,
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  expect((await repository.read(guest)).files).toEqual(["knowledge/team.md"]);
  denied(
    await Promise.try(async () => inviteWorkspaceMember(guest, "anyname")).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  expect((await readWorkspaceTeam(guest)).mayManage).toBe(false);
  denied(
    await Promise.try(async () =>
      issueAgentGrant(guest, {
        label: "x",
        capabilities: ["files"],
        days: 1,
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
});
test("SP05: removing a member ends every durable authority they held in the workspace", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, guestPersonal } = workspace;
  const scope = {
    userId: guest.userId,
    workspaceId: guest.workspaceId,
  };
  const ids = {
    jobId: randomUUID(),
    grantId: randomUUID(),
    taskId: randomUUID(),
    sessionId: `session-${randomUUID()}`,
  };
  await query(sql`INSERT INTO scheduled_agent_jobs(id, workspace_id, created_by_user_id, prompt, conversation_channel, conversation_id, timing, next_run_at)
        VALUES (${ids.jobId}, ${guest.workspaceId}, ${guest.userId}, 'Synthetic schedule', 'eve', ${randomUUID()}, '{"kind":"once","at":"2030-01-01T12:00:00Z"}', '2030-01-01T12:00:00Z')`);
  const bot = await saveWorkspaceBot(actor, {
    username: `b${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    name: "Test Zoen",
    description: "Synthetic knowledge assistant",
    discoverable: false,
  });
  await query(sql`INSERT INTO workspace_agent_grants(id, bot_id, issued_by, label, token_hash, capabilities, expires_at)
        VALUES (${ids.grantId}, ${bot.id}, ${guest.userId}, 'Issued by the guest', ${createHash("sha256").update(randomUUID()).digest("hex")}, ${JSON.stringify(["files"])}::jsonb, now() + interval '1 day')`);
  await query(sql`INSERT INTO agent_protocol_tasks(id, grant_id, context_id, message_id, request_hash, prompt, state)
        VALUES (${ids.taskId}, ${ids.grantId}, ${randomUUID()}, ${randomUUID()}, ${createHash("sha256").update("Synthetic task").digest("hex")}, 'Synthetic task', 'TASK_STATE_WORKING')`);
  await claimSession(scope, ids.sessionId);
  await query(sql`INSERT INTO workspace_connections(workspace_id, label, credentials, connected_by)
        VALUES (${actor.workspaceId}, 'shared@example.invalid', 'not-a-ciphertext', ${actor.userId})`);
  expect(await durableAuthority(sql, ids)).toEqual([
    {
      job: "active",
      grantRevoked: false,
      task: "TASK_STATE_WORKING",
      sessions: 1,
    },
  ]);
  const reachable = await Promise.try(async () =>
    getWorkspaceGoogleToken(scope)
  ).then(
    (value) => ({
      ok: true as const,
      value,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    })
  );
  expect(!reachable.ok && reachable.error).toMatchObject({
    reason: "unavailable",
  });
  await removeWorkspaceMember(actor, guest.userId);
  denied(
    await Promise.try(async () => requireWorkspaceAccess(guest)).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  await assert.rejects(ensureScope(scope), {
    _tag: "ScopeAccessDenied",
  });
  expect(await durableAuthority(sql, ids)).toEqual([
    {
      job: null,
      grantRevoked: true,
      task: "TASK_STATE_CANCELED",
      sessions: 0,
    },
  ]);
  const unreachable = await Promise.try(async () =>
    getWorkspaceGoogleToken(scope)
  ).then(
    (value) => ({
      ok: true as const,
      value,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    })
  );
  expect(!unreachable.ok && unreachable.error).toMatchObject({
    reason: "authorization_required",
  });
  expect((await requireWorkspaceAccess(guestPersonal)).role).toBe("owner");
  expect(
    (await readWorkspaceTeam(actor)).members.map((member) => member.userId)
  ).toEqual([actor.userId]);
  expect(
    await query(sql`SELECT metadata FROM organization_audit_receipts
          WHERE action = 'member_removed' AND target_user_id = ${guest.userId}
          ORDER BY created_at DESC LIMIT 1`)
  ).toEqual([
    {
      metadata: {
        removedSessions: 1,
        removedJobs: 1,
        cancelledOutbox: 0,
        revokedGrants: 1,
        canceledTasks: 1,
      },
    },
  ]);
});
test("SP06: a group cannot act in the owner's personal space or reach personal scope", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal } = workspace;
  const installationId = `group-${randomUUID()}`;
  const owner = await linkedIdentity(
    {
      channel: "telegram",
      installationId,
      senderId: "owner",
    },
    {
      userId: actor.userId.slice("better-auth:".length),
    }
  );
  const principal: SessionAuthContext = {
    principalType: "user",
    principalId: actor.userId,
    authenticator: "verified-channel",
    attributes: {
      workspaceId: personal.workspaceId,
      chatKind: "group",
      channelIdentityId: owner.id,
    },
  };
  denied(
    await Promise.try(async () => workspaceActorFromPrincipal(principal)).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  assert.throws(() => scopeFromPrincipal(principal), {
    _tag: "PrincipalScopeError",
  });
  const member = await linkedIdentity(
    {
      channel: "telegram",
      installationId,
      senderId: "member",
    },
    {
      userId: guest.userId.slice("better-auth:".length),
    }
  );
  const teamBinding = randomUUID();
  const personalBinding = randomUUID();
  await query(sql`INSERT INTO workspace_group_bindings(id, workspace_id, channel, installation_id, conversation_id, label, created_by) VALUES
        (${teamBinding}, ${guest.workspaceId}, 'telegram', ${installationId}, ${randomUUID()}, 'Team group', ${actor.userId}),
        (${personalBinding}, ${personal.workspaceId}, 'telegram', ${installationId}, ${randomUUID()}, 'Owner group', ${actor.userId})`);
  const group = {
    userId: guest.userId,
    workspaceId: guest.workspaceId,
    channelIdentityId: member.id,
    groupBindingId: teamBinding,
  };
  expect((await requireWorkspaceAccess(group)).role).toBe("member");
  await query(
    sql`UPDATE workspace_group_bindings SET revoked_at = now() WHERE id = ${teamBinding}`
  );
  denied(
    await Promise.try(async () => requireWorkspaceAccess(group)).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  denied(
    await Promise.try(async () =>
      requireWorkspaceAccess({
        ...group,
        workspaceId: personal.workspaceId,
        groupBindingId: personalBinding,
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
});
test("SP02: an accepted invitation cannot be answered again by anyone", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, guestPersonal } = workspace;
  const username = `u${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
  );
  await saveDirectoryProfile(guestPersonal, {
    username,
    discoverable: false,
  });
  const invitation = await inviteWorkspaceMember(actor, username);
  const invitationId = invitation.id;
  if (!invitationId) throw new Error("Invitation ID missing");
  expect(
    await answerWorkspaceInvitation(guestPersonal, invitationId, true)
  ).toEqual({
    workspaceId: actor.workspaceId,
  });
  denied(
    await Promise.try(async () =>
      answerWorkspaceInvitation(guestPersonal, invitationId, true)
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  denied(
    await Promise.try(async () =>
      answerWorkspaceInvitation(actor, invitationId, true)
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  );
  expect(
    await query(sql`SELECT count(*)::int AS memberships FROM workspace_memberships
          WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`)
  ).toEqual([
    {
      memberships: 1,
    },
  ]);
});
test("SP05: removal cancels the rendered report chunks a member had queued", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest } = workspace;
  const identity = await linkedIdentity(
    {
      channel: "telegram",
      installationId: `boundary-${randomUUID()}`,
      senderId: randomUUID(),
    },
    {
      userId: guest.userId.slice("better-auth:".length),
    }
  );
  const jobId = randomUUID();
  const runId = randomUUID();
  await query(sql`INSERT INTO scheduled_agent_jobs
        (id, workspace_id, created_by_user_id, conversation_channel, conversation_id, prompt, timing, status)
        VALUES (${jobId}, ${guest.workspaceId}, ${guest.userId}, 'telegram', ${identity.id}, 'Report task',
          '{"kind":"once","at":"2030-01-01T00:00:00Z"}'::jsonb, 'completed')`);
  await query(sql`INSERT INTO scheduled_agent_runs (id, job_id, scheduled_for, status, report_status, outcome)
        VALUES (${runId}, ${jobId}, clock_timestamp(), 'completed', 'pending',
          ${sql`${JSON.stringify({
            kind: "result",
            summary: "s".repeat(4000),
            details: "d".repeat(5000),
            urgency: "normal",
          })}::jsonb`})`);
  await dispatchNativeScheduledReport(runId);
  expect(await chunks(identity.id)).toEqual([
    {
      status: "queued",
      lastError: null,
    },
    {
      status: "queued",
      lastError: null,
    },
    {
      status: "queued",
      lastError: null,
    },
  ]);
  await removeWorkspaceMember(actor, guest.userId);
  expect(await chunks(identity.id)).toEqual([
    {
      status: "cancelled",
      lastError: "member_removed",
    },
    {
      status: "cancelled",
      lastError: "member_removed",
    },
    {
      status: "cancelled",
      lastError: "member_removed",
    },
  ]);
  expect(
    await query(
      sql`SELECT run_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
    )
  ).toHaveLength(0);
  expect(
    await query(sql`SELECT metadata FROM organization_audit_receipts
          WHERE action = 'member_removed' AND target_user_id = ${guest.userId}
          ORDER BY created_at DESC LIMIT 1`)
  ).toEqual([
    {
      metadata: {
        removedSessions: 0,
        removedJobs: 1,
        cancelledOutbox: 3,
        revokedGrants: 0,
        canceledTasks: 0,
      },
    },
  ]);
});

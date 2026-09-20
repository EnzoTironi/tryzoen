import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { toolContextFor } from "../helpers/tool-context";
import { randomUUID } from "node:crypto";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { WorkspaceRepository } from "../../server/workspaces/repository";

export const workspaceFixture = async function () {
  const resources = new AsyncDisposableStack();
  const id = randomUUID();
  const userId = `workspace-proof-${id}`;
  const guestId = `workspace-guest-${id}`;
  const orgId = `org-${id}`;
  const workspaceId = `team-${id}`;
  const personal = accessScopeForUser(`better-auth:${userId}`);
  const guestPersonal = accessScopeForUser(`better-auth:${guestId}`);
  const actor = { userId: personal.userId, workspaceId, authSessionId: id };
  const guest = {
    userId: `better-auth:${guestId}`,
    workspaceId,
    authSessionId: guestId,
  };
  resources.defer(async () => {
    await query(
      sql`DELETE FROM workspaces WHERE organization_id = ${orgId} OR id IN (${personal.workspaceId}, ${guestPersonal.workspaceId})`
    );
    await query(
      sql`DELETE FROM organization_audit_receipts WHERE organization_id = ${orgId}`
    );
    await query(sql`DELETE FROM organizations WHERE id = ${orgId}`);
    await query(
      sql`DELETE FROM public.user WHERE id IN (${userId}, ${guestId})`
    );
  });
  try {
    await query(sql`INSERT INTO public.user (id, name, email) VALUES
    (${userId}, 'Synthetic owner', ${`${userId}@example.invalid`}),
    (${guestId}, 'Synthetic guest', ${`${guestId}@example.invalid`})`);
    await query(sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "updatedAt") VALUES
    (${id}, ${id}, ${userId}, now() + interval '1 hour', now()),
    (${guestId}, ${guestId}, ${guestId}, now() + interval '1 hour', now())`);
    await query(
      sql`INSERT INTO organizations (id, name) VALUES (${orgId}, 'Synthetic company')`
    );
    await query(
      sql`INSERT INTO workspaces (id, organization_id) VALUES (${workspaceId}, ${orgId}), (${personal.workspaceId}, NULL), (${guestPersonal.workspaceId}, NULL)`
    );
    await query(sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES
    (${orgId}, ${actor.userId}, 'admin'), (${orgId}, ${guest.userId}, 'member')`);
    await query(sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
    (${workspaceId}, ${actor.userId}, 'admin'), (${workspaceId}, ${guest.userId}, 'member'),
    (${personal.workspaceId}, ${actor.userId}, 'owner'), (${guestPersonal.workspaceId}, ${guest.userId}, 'owner')`);
    return {
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
      actor,
      guest,
      personal: { ...actor, workspaceId: personal.workspaceId },
      guestPersonal: { ...guest, workspaceId: guestPersonal.workspaceId },
      repository: WorkspaceRepository,
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
};

export function workspaceExecutionFor(
  actor: Awaited<ReturnType<typeof workspaceFixture>>["actor" | "guest"]
) {
  const base = toolContextFor({
    toolName: "test-tool",
    callId: randomUUID(),
    sessionId: randomUUID(),
  });
  const principal = {
    principalId: actor.userId,
    principalType: "user",
    authenticator: "authjs",
    attributes: {
      workspaceId: actor.workspaceId,
      authSessionId: actor.authSessionId,
    },
  };
  return {
    ...base,
    session: {
      ...base.session,
      auth: { current: principal, initiator: principal },
    },
  };
}

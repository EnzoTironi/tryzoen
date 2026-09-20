import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { expect, test } from "vitest";
import {
  AccountDeletionError,
  applyAccountDeletionTombstones,
  closeOrganizationForDeletion,
  requestAccountDeletion,
  transferOrganizationAdmin,
} from "../../server/accounts/deletion";
import { startWhatsAppPairing } from "../../server/workspaces/whatsapp";

import { workspaceFixture } from "./workspace-fixture";
import { installErasureJournalFixture } from "./erasure-journal-fixture";

const denied = (
  result: { ok: true; value: unknown } | { ok: false; error: unknown }
) => {
  expect(!result.ok).toBe(true);
};

test("a company member's deletion keeps company git and never delivers to live providers", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, guestPersonal, repository } = workspace;
  const personalCanary = `personal-${randomUUID()}`;
  const companyCanary = `company-${randomUUID()}`;
  await repository.write(guestPersonal, {
    content: personalCanary,
    expectedRevision: null,
    operationId: randomUUID(),
    path: "knowledge/private.md",
  });
  await repository.write(actor, {
    content: companyCanary,
    expectedRevision: null,
    operationId: randomUUID(),
    path: "knowledge/team.md",
  });
  await query(sql`INSERT INTO chats(session_id, workspace_id, title) VALUES
        (${randomUUID()}, ${guestPersonal.workspaceId}, ${personalCanary})`);
  await query(sql`INSERT INTO scheduled_agent_jobs(
          id, workspace_id, created_by_user_id, prompt, conversation_channel, conversation_id, timing, next_run_at
        ) VALUES (
          ${randomUUID()}, ${guest.workspaceId}, ${guest.userId}, 'Synthetic schedule', 'eve', ${randomUUID()},
          '{"kind":"once","at":"2030-01-01T12:00:00Z"}', '2030-01-01T12:00:00Z'
        )`);
  await query(sql`INSERT INTO workspace_connections(workspace_id, label, credentials, connected_by)
        VALUES (${guest.workspaceId}, 'Shared Google', 'token', ${guest.userId})`);
  await query(sql`INSERT INTO telemetry_events(id, user_id, kind, metadata)
        VALUES (${randomUUID()}, ${guest.userId}, 'turn', '{}')`);
  await query(sql`INSERT INTO matrix_identities(user_id, matrix_id)
        VALUES (${guest.userId}, ${`@guest-${randomUUID()}:zoen.test`})`);
  await query(sql`INSERT INTO vault_items (id, workspace_id, kind, label, account)
        VALUES (${`vault-${randomUUID()}`}, ${guestPersonal.workspaceId}, 'login', ${personalCanary}, 'personal@example.invalid')`);
  await query(sql`INSERT INTO encrypted_secrets (workspace_id, namespace, id, encrypted_value)
        VALUES (${guestPersonal.workspaceId}, 'vault', ${personalCanary}, 'ciphertext')`);
  await startWhatsAppPairing(guestPersonal);
  denied(
    await Promise.try(async () =>
      requestAccountDeletion({
        ...guest,
        authSessionId: undefined,
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  expect(
    (
      await query<{
        count: number;
      }>(
        sql`SELECT count(*)::int AS count FROM public."user" WHERE id = ${guest.userId.slice("better-auth:".length)}`
      )
    )[0]?.count
  ).toBe(1);
  const deleted = await requestAccountDeletion(guest);
  expect(deleted.status).toBe("pending_external");
  expect(deleted.pending).toEqual(
    expect.arrayContaining(["vaultwarden", "whatsapp", "matrix", "mem0"])
  );
  expect(deleted.backupExpiresAt).toMatch(/T/);
  expect(
    (
      await query<{
        count: number;
      }>(
        sql`SELECT count(*)::int AS count FROM public."user" WHERE id = ${guest.userId.slice("better-auth:".length)}`
      )
    )[0]?.count
  ).toBe(0);
  expect(
    await query(
      sql`SELECT 1 FROM public.session WHERE "userId" = ${guest.userId.slice("better-auth:".length)}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM workspaces WHERE id = ${guestPersonal.workspaceId}`
    )
  ).toHaveLength(0);
  expect(
    await query(sql`SELECT 1 FROM chats WHERE title = ${personalCanary}`)
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM workspace_repository WHERE workspace_id = ${guestPersonal.workspaceId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM scheduled_agent_jobs WHERE created_by_user_id = ${guest.userId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM telemetry_events WHERE user_id = ${guest.userId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_identities WHERE user_id = ${guest.userId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM vault_items WHERE workspace_id = ${guestPersonal.workspaceId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM encrypted_secrets WHERE workspace_id = ${guestPersonal.workspaceId}`
    )
  ).toHaveLength(0);
  expect((await repository.read(actor, "knowledge/team.md")).content).toBe(
    companyCanary
  );
  expect(
    await query(sql`SELECT 1 FROM workspaces WHERE id = ${actor.workspaceId}`)
  ).toHaveLength(1);
  expect(
    await query(
      sql`SELECT 1 FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`
    )
  ).toHaveLength(1);
  expect(
    await query(
      sql`SELECT 1 FROM account_deletion_tombstones WHERE user_id = ${guest.userId}`
    )
  ).toHaveLength(1);
  denied(
    await Promise.try(async () => requestAccountDeletion(guest)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  await query(sql`INSERT INTO public.user (id, name, email) VALUES
        (${guest.userId.slice("better-auth:".length)}, 'Restored', ${`${randomUUID()}@example.invalid`})`);
  await query(
    sql`INSERT INTO workspaces (id) VALUES (${guestPersonal.workspaceId})`
  );
  await query(sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
        (${guestPersonal.workspaceId}, ${guest.userId}, 'owner')`);
  await query(sql`INSERT INTO chats(session_id, workspace_id, title) VALUES
        (${randomUUID()}, ${guestPersonal.workspaceId}, ${personalCanary})`);
  await query(sql`INSERT INTO vault_items (id, workspace_id, kind, label, account)
        VALUES (${`vault-restore-${randomUUID()}`}, ${guestPersonal.workspaceId}, 'login', ${personalCanary}, 'restored@example.invalid')`);
  await query(sql`INSERT INTO encrypted_secrets (workspace_id, namespace, id, encrypted_value)
        VALUES (${guestPersonal.workspaceId}, 'vault', ${`restore-${personalCanary}`}, 'restored-ciphertext')`);
  await query(sql`INSERT INTO whatsapp_bridge_accounts (
          workspace_id, user_id, pairing_nonce_hash, remote_user_id, matrix_user_id, login_id, status, expires_at, connected_at
        ) VALUES (
          ${guestPersonal.workspaceId}, ${guest.userId}, 'restored', ${`wa-${randomUUID()}`},
          ${`@restored-wa-${randomUUID()}:zoen.test`}, ${randomUUID()}, 'connected', now() + interval '1 day', clock_timestamp()
        )`);
  await query(sql`INSERT INTO matrix_identities(user_id, matrix_id)
        VALUES (${guest.userId}, ${`@restored-${randomUUID()}:zoen.test`})`);
  await applyAccountDeletionTombstones();
  expect(
    await query(sql`SELECT 1 FROM chats WHERE title = ${personalCanary}`)
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM vault_items WHERE workspace_id = ${guestPersonal.workspaceId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM encrypted_secrets WHERE workspace_id = ${guestPersonal.workspaceId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM whatsapp_bridge_accounts WHERE workspace_id = ${guestPersonal.workspaceId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_identities WHERE user_id = ${guest.userId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM public."user" WHERE id = ${guest.userId.slice("better-auth:".length)}`
    )
  ).toHaveLength(0);
  expect((await repository.read(actor, "knowledge/team.md")).content).toBe(
    companyCanary
  );
  return true;
});

test("the last company admin must transfer or close before deletion", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest } = workspace;
  const orgs = await query<{
    organization_id: string;
  }>(
    sql`SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}`
  );
  const organizationId = orgs[0]?.organization_id ?? "";
  const blocked = await Promise.try(async () =>
    requestAccountDeletion(actor)
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!blocked.ok && blocked.error).toBeInstanceOf(AccountDeletionError);
  expect(
    !blocked.ok &&
      blocked.error instanceof AccountDeletionError &&
      blocked.error.reason
  ).toBe("blocked_sole_owner");
  expect(
    (
      await query<{
        count: number;
      }>(
        sql`SELECT count(*)::int AS count FROM public."user" WHERE id = ${actor.userId.slice("better-auth:".length)}`
      )
    )[0]?.count
  ).toBe(1);
  await transferOrganizationAdmin(actor, {
    organizationId,
    targetUserId: guest.userId,
  });
  const deleted = await requestAccountDeletion(actor);
  expect(deleted.status).toBe("pending_external");
  expect(
    await query(
      sql`SELECT 1 FROM public."user" WHERE id = ${actor.userId.slice("better-auth:".length)}`
    )
  ).toHaveLength(0);
  expect(
    await query(sql`SELECT 1 FROM workspaces WHERE id = ${actor.workspaceId}`)
  ).toHaveLength(1);
  expect(
    await query(
      sql`SELECT 1 FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
    )
  ).toHaveLength(1);
  return true;
});

test("closing the last company workspace unblocks the remaining owner", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest } = workspace;
  const orgs = await query<{
    organization_id: string;
  }>(
    sql`SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}`
  );
  const organizationId = orgs[0]?.organization_id ?? "";
  await requestAccountDeletion(guest);
  denied(
    await Promise.try(async () => requestAccountDeletion(actor)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  await closeOrganizationForDeletion(actor, { organizationId });
  expect(
    await query(sql`SELECT 1 FROM workspaces WHERE id = ${actor.workspaceId}`)
  ).toHaveLength(0);
  const deleted = await requestAccountDeletion(actor);
  expect(deleted.status).toBe("pending_external");
  expect(
    await query(
      sql`SELECT 1 FROM public."user" WHERE id = ${actor.userId.slice("better-auth:".length)}`
    )
  ).toHaveLength(0);
  return true;
});

test("review #119: concurrent deletion cannot leave a company without any administrator", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest } = workspace;
  const org = await query<{
    organization_id: string;
  }>(
    sql`SELECT organization_id FROM workspaces WHERE id = ${actor.workspaceId}`
  );
  const organizationId = org[0]?.organization_id;
  if (!organizationId) throw new Error("Company fixture missing");
  await query(
    sql`UPDATE organization_memberships SET role = 'admin' WHERE user_id = ${guest.userId}`
  );
  await query(
    sql`UPDATE workspace_memberships SET role = 'admin' WHERE user_id = ${guest.userId} AND workspace_id = ${actor.workspaceId}`
  );
  const results = await Promise.all([
    Promise.try(async () => requestAccountDeletion(actor)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    ),
    Promise.try(async () => requestAccountDeletion(guest)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    ),
  ]);
  const admins = await query(
    sql`SELECT user_id FROM organization_memberships WHERE organization_id = ${organizationId} AND role = 'admin'`
  );
  expect({
    completed: results.filter((result) => result.ok).length,
    remainingAdmins: admins.length,
  }).toEqual({ completed: 1, remainingAdmins: 1 });
});

installErasureJournalFixture();

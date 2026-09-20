import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { expect, test } from "vitest";

import { listVaultItems, saveVaultItem } from "../../db/services/vault";
import { serializeLoginVaultPayload } from "../../shared/vault/schema";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { removeWorkspaceMember } from "../../server/workspaces/team";
import {
  delegateVaultItem,
  inspectVaultDelegations,
  listDelegatedVaultItems,
  releaseDelegatedSecret,
  requireVaultwarden,
  revokeVaultDelegation,
  VaultwardenUnavailable,
} from "../../server/workspaces/vault";

import { workspaceFixture } from "./workspace-fixture";

const denied = (
  result: { ok: true; value: unknown } | { ok: false; error: unknown }
) => {
  expect(!result.ok).toBe(true);
};
const login = (label: string, password: string) => ({
  kind: "login" as const,
  label,
  account: "",
  secret: serializeLoginVaultPayload({
    version: 2,
    kind: "login",
    origin: "https://login.example.invalid",
    identifier: { type: "email", value: `${label}@example.invalid` },
    authentication: { type: "password", password },
  }),
});

test("Vaultwarden stays unavailable without a live instance", async () => {
  const result = await Promise.try(async () => requireVaultwarden()).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!result.ok && result.error).toBeInstanceOf(VaultwardenUnavailable);
  return true;
});

test("the agent unwraps only the delegated item and does not read the user ciphertext", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal } = workspace;
  const scope = {
    userId: actor.userId,
    workspaceId: actor.workspaceId,
  };
  const delegatedPassword = `canary-delegated-${randomUUID()}`;
  const privatePassword = `canary-private-${randomUUID()}`;
  await Promise.try(async () =>
    saveVaultItem(scope, login("Delegated", delegatedPassword))
  ).catch(() => {
    throw new WorkspaceAccessDenied();
  });
  await Promise.try(async () =>
    saveVaultItem(scope, login("Private", privatePassword))
  ).catch(() => {
    throw new WorkspaceAccessDenied();
  });
  const saved = await Promise.try(async () => listVaultItems(scope)).catch(
    () => {
      throw new WorkspaceAccessDenied();
    }
  );
  const delegated = saved.find((item) => item.label === "Delegated");
  const kept = saved.find((item) => item.label === "Private");
  if (!delegated || !kept) throw new WorkspaceAccessDenied();
  expect(await listDelegatedVaultItems(scope)).toEqual([]);
  denied(
    await Promise.try(async () =>
      delegateVaultItem(guest, {
        itemId: delegated.id,
        days: 7,
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  const grant = await delegateVaultItem(actor, {
    itemId: delegated.id,
    days: 7,
  });
  expect(
    await delegateVaultItem(actor, { itemId: delegated.id, days: 7 })
  ).toEqual(grant);
  const controls = await inspectVaultDelegations(actor);
  expect(controls.mayManage).toBe(true);
  expect(controls.items).toEqual([
    expect.objectContaining({ id: grant.id, itemId: delegated.id }),
  ]);
  expect((await inspectVaultDelegations(guest)).mayManage).toBe(false);
  const listed = await listDelegatedVaultItems(scope);
  expect(listed.map((item) => item.handle)).toEqual([delegated.id]);
  expect(JSON.stringify(listed)).not.toContain(delegatedPassword);
  expect(JSON.stringify(listed)).not.toContain(privatePassword);
  await query(sql`UPDATE encrypted_secrets SET encrypted_value = 'garbage'
        WHERE workspace_id = ${actor.workspaceId} AND id = ${delegated.id}`);
  const released = await releaseDelegatedSecret(scope, delegated.id);
  expect(released.reveal()).toContain(delegatedPassword);
  denied(
    await Promise.try(async () => releaseDelegatedSecret(scope, kept.id)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  denied(
    await Promise.try(async () =>
      releaseDelegatedSecret(
        { userId: actor.userId, workspaceId: personal.workspaceId },
        delegated.id
      )
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  const guestFill = await releaseDelegatedSecret(
    { userId: guest.userId, workspaceId: actor.workspaceId },
    delegated.id
  );
  expect(guestFill.reveal()).toContain(delegatedPassword);
  await revokeVaultDelegation(actor, grant.id);
  await revokeVaultDelegation(actor, grant.id);
  denied(
    await Promise.try(async () =>
      releaseDelegatedSecret(scope, delegated.id)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  expect(await listDelegatedVaultItems(scope)).toEqual([]);
  return true;
});

test("company delegations stay off the personal workspace and expiry plus removal end fill", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal } = workspace;
  const companyScope = {
    userId: actor.userId,
    workspaceId: actor.workspaceId,
  };
  const password = `canary-company-${randomUUID()}`;
  await Promise.try(async () =>
    saveVaultItem(companyScope, login("Company", password))
  ).catch(() => {
    throw new WorkspaceAccessDenied();
  });
  const saved = await Promise.try(async () =>
    listVaultItems(companyScope)
  ).catch(() => {
    throw new WorkspaceAccessDenied();
  });
  const item = saved[0];
  if (!item) throw new WorkspaceAccessDenied();
  const grant = await delegateVaultItem(actor, {
    itemId: item.id,
    days: 7,
  });
  expect(
    await listDelegatedVaultItems({
      userId: actor.userId,
      workspaceId: personal.workspaceId,
    })
  ).toEqual([]);
  denied(
    await Promise.try(async () =>
      releaseDelegatedSecret(
        { userId: actor.userId, workspaceId: personal.workspaceId },
        item.id
      )
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  expect(
    (await releaseDelegatedSecret(companyScope, item.id)).reveal()
  ).toContain(password);
  await query(sql`UPDATE vault_item_delegations SET expires_at = now() - interval '1 minute'
        WHERE id = ${grant.id}`);
  denied(
    await Promise.try(async () =>
      releaseDelegatedSecret(companyScope, item.id)
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  await delegateVaultItem(actor, { itemId: item.id, days: 7 });
  expect(
    (
      await releaseDelegatedSecret(
        { userId: guest.userId, workspaceId: actor.workspaceId },
        item.id
      )
    ).reveal()
  ).toContain(password);
  await removeWorkspaceMember(actor, guest.userId);
  denied(
    await Promise.try(async () =>
      releaseDelegatedSecret(
        { userId: guest.userId, workspaceId: actor.workspaceId },
        item.id
      )
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  );
  return true;
});

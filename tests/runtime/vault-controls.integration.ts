import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../../server/workspaces/access";
import { expect, test } from "vitest";
import { query, transaction } from "@db/queries";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { readVaultSecret } from "@db/services/vault";
import { workspaceFixture } from "./workspace-fixture";
import { serializeLoginVaultPayload } from "@zoen/companion-ui/vault";
import {
  createAccountVaultItem,
  listAccountVaultItems,
  readAccountVaultItem,
  updateAccountVaultItem,
  removeAccountVaultItem,
} from "../../server/workspaces/vault/items";
import {
  delegateVaultItem,
  releaseDelegatedSecret,
} from "../../server/workspaces/vault";

async function headersFor(actor: z.infer<typeof WorkspaceActorSchema>) {
  if (!actor.authSessionId) throw Error("Expected fixture session");
  const { betterAuthSecret } = await getInstallationSecrets();
  const signature = createHmac("sha256", betterAuthSecret)
    .update(actor.authSessionId)
    .digest("base64");
  return new Headers({
    cookie: `better-auth.session_token=${encodeURIComponent(`${actor.authSessionId}.${signature}`)}`,
    "x-zoen-workspace": actor.workspaceId,
  });
}
const login = (label: string) => ({
  kind: "login" as const,
  label,
  account: "",
  secret: serializeLoginVaultPayload({
    version: 2,
    kind: "login",
    origin: "https://example.invalid",
    identifier: { type: "email", value: "synthetic@example.invalid" },
    authentication: { type: "password", password: "synthetic-secret-canary" },
  }),
});

test("vault controls enforce company roles and account isolation without exposing secrets", async () => {
  await using fixture = await workspaceFixture();
  const owner = await headersFor(fixture.actor),
    member = await headersFor(fixture.guest),
    foreign = await headersFor(fixture.guestPersonal);
  await createAccountVaultItem(owner, login("Saved login"));
  const page = await listAccountVaultItems(member, { kind: "login" });
  expect(page.mayManage).toBe(false);
  expect(page.items).toHaveLength(1);
  expect(JSON.stringify(page)).not.toContain("synthetic-secret-canary");
  const item = page.items[0];
  if (!item) throw Error("Expected saved item");
  await expect(createAccountVaultItem(member, login("Denied"))).rejects.toThrow(
    /access|session|sign|auth|permission/i
  );
  await expect(removeAccountVaultItem(member, item.id)).rejects.toThrow(
    /access|session|sign|auth|permission/i
  );
  expect((await listAccountVaultItems(foreign, {})).items).toHaveLength(0);
  expect(await removeAccountVaultItem(foreign, item.id)).toBe(false);
  expect((await listAccountVaultItems(owner, {})).mayManage).toBe(true);
  expect(await readVaultSecret(fixture.actor, item.id)).toContain(
    "synthetic-secret-canary"
  );
});

test("vault controls reject revoked sessions and memberships including personal scope without workspace header", async () => {
  await using fixture = await workspaceFixture();
  const owner = await headersFor(fixture.actor),
    member = await headersFor(fixture.guest);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id=${fixture.actor.workspaceId} AND user_id=${fixture.guest.userId}`
  );
  await expect(listAccountVaultItems(member, {})).rejects.toThrow(
    /access|session|sign|auth|permission/i
  );
  await query(
    sql`DELETE FROM public.session WHERE id=${fixture.actor.authSessionId}`
  );
  await expect(createAccountVaultItem(owner, login("Denied"))).rejects.toThrow(
    /access|session|sign|auth|permission/i
  );
  const personal = await headersFor(fixture.guestPersonal);
  personal.delete("x-zoen-workspace");
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id=${fixture.guestPersonal.workspaceId} AND user_id=${fixture.guest.userId}`
  );
  await expect(listAccountVaultItems(personal, {})).rejects.toThrow(
    /access|session|sign|auth|permission/i
  );
});

test("vault creation and removal roll back ciphertext, metadata and grants together", async () => {
  await using fixture = await workspaceFixture();
  const owner = await headersFor(fixture.actor);
  await expect(
    transaction(async () => {
      await createAccountVaultItem(owner, login("Rolled back"));
      throw Error("Synthetic rollback");
    })
  ).rejects.toThrow("Synthetic rollback");
  expect((await listAccountVaultItems(owner, {})).items).toHaveLength(0);
  expect(
    await query(
      sql`SELECT id FROM encrypted_secrets WHERE workspace_id=${fixture.actor.workspaceId}`
    )
  ).toHaveLength(0);
  await createAccountVaultItem(owner, login("Kept"));
  const item = (await listAccountVaultItems(owner, {})).items[0];
  if (!item) throw Error("Expected item");
  const grant = await delegateVaultItem(fixture.actor, {
    itemId: item.id,
    days: 1,
  });
  await expect(
    transaction(async () => {
      await removeAccountVaultItem(owner, item.id);
      throw Error("Synthetic rollback");
    })
  ).rejects.toThrow("Synthetic rollback");
  expect(await readVaultSecret(fixture.actor, item.id)).toContain(
    "synthetic-secret-canary"
  );
  expect(
    await query(sql`SELECT id FROM vault_item_delegations WHERE id=${grant.id}`)
  ).toHaveLength(1);
  expect(await removeAccountVaultItem(owner, item.id)).toBe(true);
  expect(await readVaultSecret(fixture.actor, item.id)).toBeUndefined();
  expect(
    await query(sql`SELECT id FROM vault_item_delegations WHERE id=${grant.id}`)
  ).toHaveLength(0);
});

test("vault pages remain bounded with stable cursor ties", async () => {
  await using fixture = await workspaceFixture();
  const owner = await headersFor(fixture.actor);
  for (let index = 0; index < 23; index++)
    await createAccountVaultItem(owner, login(`Item ${index}`));
  await query(
    sql`UPDATE vault_items SET updated_at='2026-01-01T00:00:00Z' WHERE workspace_id=${fixture.actor.workspaceId}`
  );
  const first = await listAccountVaultItems(owner, { kind: "login" });
  expect(first.items).toHaveLength(20);
  expect(first.nextCursor).not.toBeNull();
  const next = await listAccountVaultItems(owner, {
    kind: "login",
    cursor: first.nextCursor,
  });
  expect(next.items).toHaveLength(3);
  expect(next.nextCursor).toBeNull();
  expect(
    new Set([...first.items, ...next.items].map((item) => item.id)).size
  ).toBe(23);
  expect(await removeAccountVaultItem(owner, randomUUID())).toBe(false);
});

test("explicit secret reads and edits require current manager authority", async () => {
  await using fixture = await workspaceFixture();
  const owner = await headersFor(fixture.actor),
    member = await headersFor(fixture.guest),
    foreign = await headersFor(fixture.guestPersonal);
  await createAccountVaultItem(owner, login("Private edit"));
  const [item] = (await listAccountVaultItems(owner, {})).items;
  if (!item) throw Error("Expected item");
  expect((await readAccountVaultItem(owner, item))?.secret).toContain(
    "synthetic-secret-canary"
  );
  await expect(readAccountVaultItem(member, item)).rejects.toThrow(
    /access|session|sign|auth|permission/i
  );
  await expect(
    updateAccountVaultItem(member, { item, value: login("Denied") })
  ).rejects.toThrow(/access|session|sign|auth|permission/i);
  expect(await readAccountVaultItem(foreign, item)).toBeNull();
  expect(
    await updateAccountVaultItem(foreign, { item, value: login("Denied") })
  ).toBe(false);
  await query(
    sql`DELETE FROM organization_memberships WHERE user_id=${fixture.actor.userId}`
  );
  await expect(readAccountVaultItem(owner, item)).rejects.toThrow(
    /access|session|sign|auth|permission/i
  );
  await expect(
    updateAccountVaultItem(owner, { item, value: login("Denied") })
  ).rejects.toThrow(/access|session|sign|auth|permission/i);
});

test("an edit atomically replaces ciphertext and hints, invalidates old snapshots and revokes old grants", async () => {
  await using fixture = await workspaceFixture();
  const owner = await headersFor(fixture.actor);
  await createAccountVaultItem(owner, login("Original"));
  // Include a sub-millisecond legacy timestamp and a clock in the future.
  await query(
    sql`UPDATE vault_items SET updated_at='2100-01-01T00:00:00.123456Z' WHERE workspace_id=${fixture.actor.workspaceId}`
  );
  const [item] = (await listAccountVaultItems(owner, {})).items;
  if (!item) throw Error("Expected item");
  const grant = await delegateVaultItem(fixture.actor, {
    itemId: item.id,
    days: 1,
  });
  const replacement = login("Updated");
  replacement.secret = serializeLoginVaultPayload({
    version: 2,
    kind: "login",
    origin: "https://updated.example.invalid",
    identifier: { type: "username", value: "new-owner" },
    authentication: { type: "password", password: "replacement-secret-canary" },
  });
  expect(
    await updateAccountVaultItem(owner, { item, value: replacement })
  ).toBe(true);
  const page = await listAccountVaultItems(owner, {});
  expect(page.items).toHaveLength(1);
  const [updated] = page.items;
  if (!updated) throw Error("Expected updated item");
  expect(updated.id).toBe(item.id);
  expect(updated.label).toBe("Updated");
  expect(updated.account).toContain("updated.example.invalid");
  expect(Date.parse(updated.updatedAt)).toBeGreaterThan(
    Date.parse(item.updatedAt)
  );
  expect(JSON.stringify(page)).not.toContain("replacement-secret-canary");
  expect(await readAccountVaultItem(owner, item)).toBeNull();
  expect(
    await updateAccountVaultItem(owner, { item, value: login("Stale") })
  ).toBe(false);
  expect((await readAccountVaultItem(owner, updated))?.secret).toContain(
    "replacement-secret-canary"
  );
  await expect(releaseDelegatedSecret(fixture.actor, item.id)).rejects.toThrow(
    /access|session|sign|auth|permission/i
  );
  expect(
    await query(
      sql`SELECT wrapped_secret FROM vault_item_delegations WHERE id=${grant.id}`
    )
  ).toEqual([{ wrapped_secret: "revoked" }]);
  await delegateVaultItem(fixture.actor, { itemId: item.id, days: 1 });
  expect(
    (await releaseDelegatedSecret(fixture.actor, item.id)).reveal()
  ).toContain("replacement-secret-canary");
});

test("simultaneous edits accept one revision once and leave the other untouched", async () => {
  await using fixture = await workspaceFixture();
  const owner = await headersFor(fixture.actor);
  await createAccountVaultItem(owner, login("Concurrent"));
  const [item] = (await listAccountVaultItems(owner, {})).items;
  if (!item) throw Error("Expected item");
  const results = await Promise.all(
    ["First", "Second"].map((label) =>
      updateAccountVaultItem(owner, { item, value: login(label) })
    )
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  const [saved] = (await listAccountVaultItems(owner, {})).items;
  expect(saved?.label).toBe(results[0] ? "First" : "Second");
});

test("failed edit rolls back the secret, metadata and delegated access together", async () => {
  await using fixture = await workspaceFixture();
  const owner = await headersFor(fixture.actor);
  await createAccountVaultItem(owner, login("Rollback"));
  const [item] = (await listAccountVaultItems(owner, {})).items;
  if (!item) throw Error("Expected item");
  await delegateVaultItem(fixture.actor, { itemId: item.id, days: 1 });
  await expect(
    transaction(async () => {
      expect(
        await updateAccountVaultItem(owner, {
          item,
          value: login("Rolled back"),
        })
      ).toBe(true);
      throw Error("Synthetic rollback");
    })
  ).rejects.toThrow("Synthetic rollback");
  expect((await listAccountVaultItems(owner, {})).items).toEqual([item]);
  expect((await readAccountVaultItem(owner, item))?.label).toBe("Rollback");
  expect(
    (await releaseDelegatedSecret(fixture.actor, item.id)).reveal()
  ).toContain("synthetic-secret-canary");
});

test("an edit racing delegation never leaves the old secret actively delegated", async () => {
  await using fixture = await workspaceFixture();
  const owner = await headersFor(fixture.actor);
  await createAccountVaultItem(owner, login("Racing"));
  const [item] = (await listAccountVaultItems(owner, {})).items;
  if (!item) throw Error("Expected item");
  const value = login("Replacement");
  value.secret = value.secret.replace(
    "synthetic-secret-canary",
    "replacement-secret-canary"
  );
  await Promise.all([
    delegateVaultItem(fixture.actor, { itemId: item.id, days: 1 }),
    updateAccountVaultItem(owner, { item, value }),
  ]);
  const active = await query(sql`SELECT id FROM vault_item_delegations
    WHERE item_id=${item.id} AND revoked_at IS NULL`);
  const released = await releaseDelegatedSecret(fixture.actor, item.id).then(
    (secret) => (secret.reveal() === value.secret ? "replacement" : "stale"),
    (error: unknown) =>
      error instanceof WorkspaceAccessDenied ? "denied" : "unexpected"
  );
  expect(released).toBe(active.length ? "replacement" : "denied");
});

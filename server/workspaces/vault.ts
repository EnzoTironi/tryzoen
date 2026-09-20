import { Secret } from "@shared/environment/secret";
import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { operationSignal, withTimeout } from "../operations/async";
import { TimeoutError } from "../operations/async";
import { z } from "zod";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { resolvedInstallationSecrets } from "@db/services/installation-secrets";
import { readVaultItem, readVaultSecret } from "@db/services/vault";
import type { AccessScope } from "@shared/identity/access-scope";
import { env } from "@shared/environment";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
export class VaultwardenUnavailable extends Error {
  readonly _tag = "VaultwardenUnavailable";
  constructor() {
    super("VaultwardenUnavailable");
    this.name = "VaultwardenUnavailable";
  }
}
export const DelegateVaultItemSchema = z.object({
  itemId: z.uuid(),
  days: z.number().int().min(1).max(30),
});
const delegatedItemSchema = z.object({
  account: z.string(),
  available: z.boolean(),
  handle: z.string(),
  kind: z.string(),
  label: z.string(),
});
const installationKey = async function () {
  const secrets = await resolvedInstallationSecrets();
  return Buffer.from(secrets.secretEncryptionKey.reveal(), "base64");
};
export const requireVaultwarden = async function () {
  try {
    return await withTimeout(async () => {
      const url = env.ZOEN_VAULTWARDEN_URL;
      if (!url || !env.ZOEN_VAULTWARDEN_CLIENT_SECRET)
        throw new VaultwardenUnavailable();
      const response = await Promise.try(async () => {
        return await ((signal) =>
          fetch(`${url}/alive`, {
            method: "HEAD",
            signal,
            redirect: "error",
            cache: "no-store",
          }))(operationSignal());
      }).catch(() => {
        throw new VaultwardenUnavailable();
      });
      if (!response.ok) throw new VaultwardenUnavailable();
      return {
        url,
      };
    }, 3000);
  } catch (error) {
    if (error instanceof TimeoutError) throw new VaultwardenUnavailable();
    throw error;
  }
};

/** Admin delete uses the existing OIDC client secret. 404 means already gone. */
export const eraseVaultwardenUser = async function (rawUserId: string) {
  const { url } = await requireVaultwarden();
  const secret = env.ZOEN_VAULTWARDEN_CLIENT_SECRET;
  if (!secret) throw new VaultwardenUnavailable();
  await withTimeout(async () => {
    try {
      await (async (signal) => {
        const response = await fetch(
          `${url}/admin/users/${encodeURIComponent(rawUserId)}`,
          {
            method: "DELETE",
            signal,
            redirect: "error",
            headers: {
              authorization: `Bearer ${secret.reveal()}`,
            },
          }
        );
        if (response.ok || response.status === 404) return;
        throw new VaultwardenUnavailable();
      })(operationSignal());
      return;
    } catch (error) {
      throw error instanceof VaultwardenUnavailable
        ? error
        : new VaultwardenUnavailable();
    }
  }, 8000).catch((error: unknown) => {
    if (error instanceof TimeoutError) throw new VaultwardenUnavailable();
    throw error;
  });
  return {
    erased: true as const,
  };
};
export const listDelegatedVaultItems = async function (scope: AccessScope) {
  await requireWorkspaceMember(scope);
  const rows = await query<{
    account: string;
    handle: string;
    kind: string;
    label: string;
  }>(sql`SELECT i.account, i.id AS handle, i.kind, i.label
      FROM vault_item_delegations d
      JOIN vault_agent_identities a ON a.id = d.identity_id
      JOIN vault_items i ON i.id = d.item_id AND i.workspace_id = d.workspace_id
      WHERE d.workspace_id = ${scope.workspaceId} AND d.revoked_at IS NULL
        AND a.revoked_at IS NULL AND d.expires_at > now()
      ORDER BY i.label`);
  return await z.array(delegatedItemSchema).parseAsync(
    rows.map((row) => ({
      account: row.account,
      available: true,
      handle: row.handle,
      kind: row.kind,
      label: row.label,
    }))
  );
};
export const inspectVaultDelegations = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const access = await requireWorkspaceAccess(actor);
  const rows =
    await query(sql`SELECT d.id, d.item_id AS "itemId", d.expires_at::text AS "expiresAt"
      FROM vault_item_delegations d JOIN vault_agent_identities a ON a.id = d.identity_id
      WHERE d.workspace_id = ${actor.workspaceId} AND a.workspace_id = d.workspace_id
        AND d.revoked_at IS NULL AND a.revoked_at IS NULL AND d.expires_at > now()`);
  return {
    mayManage:
      access.role !== "member" &&
      !!actor.authSessionId &&
      !actor.groupBindingId,
    items: await z
      .array(
        z.object({
          id: z.string(),
          itemId: z.string(),
          expiresAt: z.string(),
        })
      )
      .parseAsync(rows),
  };
};
export const delegateVaultItem = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof DelegateVaultItemSchema>
) {
  const input = await DelegateVaultItemSchema.parseAsync(raw);
  return await withDatabaseTransaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vault-delegation:${actor.workspaceId}`}, 0))`
    );
    await requireWorkspaceAccess(actor, true);
    const previous = await query<{
      id: string;
    }>(sql`SELECT d.id FROM vault_item_delegations d
        JOIN vault_agent_identities a ON a.id = d.identity_id
        WHERE d.workspace_id = ${actor.workspaceId} AND d.item_id = ${input.itemId}
          AND a.revoked_at IS NULL AND d.revoked_at IS NULL AND d.expires_at > now()`);
    if (previous[0])
      return {
        id: previous[0].id,
      };
    const scope = {
      userId: actor.userId,
      workspaceId: actor.workspaceId,
    };
    const item = await Promise.try(async () =>
      readVaultItem(scope, input.itemId)
    ).catch(() => {
      throw new WorkspaceAccessDenied();
    });
    if (!item) throw new WorkspaceAccessDenied();
    const secret = await Promise.try(async () =>
      readVaultSecret(scope, input.itemId)
    ).catch(() => {
      throw new WorkspaceAccessDenied();
    });
    if (!secret) throw new WorkspaceAccessDenied();
    const identity = await ensureAgentIdentity(scope);
    await query(sql`UPDATE vault_item_delegations SET revoked_at = clock_timestamp(), wrapped_secret = 'revoked'
        WHERE identity_id = ${identity.id} AND item_id = ${input.itemId}
          AND revoked_at IS NULL AND expires_at <= now()`);
    const grantId = randomUUID();
    const expiresAt = new Date(new Date().getTime() + input.days * 86400000);
    const wrappedSecret = seal(
      identity.plaintext,
      secret,
      delegateAad(identity.id, input.itemId, grantId)
    );
    await query(sql`INSERT INTO vault_item_delegations(id, identity_id, item_id, workspace_id, wrapped_secret, issued_by, expires_at)
        VALUES (${grantId}, ${identity.id}, ${input.itemId}, ${actor.workspaceId}, ${wrappedSecret}, ${actor.userId}, ${expiresAt})`);
    return {
      id: grantId,
    };
  });
};
export const revokeVaultDelegation = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  const grantId = await Promise.try(async () => z.uuid().parseAsync(id)).catch(
    () => {
      throw new WorkspaceAccessDenied();
    }
  );
  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    const rows =
      await query(sql`UPDATE vault_item_delegations SET revoked_at = clock_timestamp(), wrapped_secret = 'revoked'
          WHERE id = ${grantId} AND workspace_id = ${actor.workspaceId} RETURNING id`);
    if (!rows.length) throw new WorkspaceAccessDenied();
    return {
      revoked: true,
    };
  });
};
export const releaseDelegatedSecret = async function (
  scope: AccessScope,
  itemId: string
) {
  await requireWorkspaceMember(scope);
  const handle = await Promise.try(async () =>
    z.uuid().parseAsync(itemId)
  ).catch(() => {
    throw new WorkspaceAccessDenied();
  });
  const rows = await query<{
    id: string;
    identity_id: string;
    wrapping_key: string;
    wrapped_secret: string;
  }>(sql`SELECT d.id, a.id AS identity_id, a.wrapping_key, d.wrapped_secret
      FROM vault_item_delegations d
      JOIN vault_agent_identities a ON a.id = d.identity_id
      WHERE d.item_id = ${handle} AND d.workspace_id = ${scope.workspaceId}
        AND d.revoked_at IS NULL AND a.revoked_at IS NULL AND d.expires_at > now()
        AND a.workspace_id = ${scope.workspaceId}
      FOR SHARE OF d, a`);
  const grant = rows[0];
  if (!grant) throw new WorkspaceAccessDenied();
  const key = await installationKey();
  const identityKey = await unwrapIdentityKey(
    key,
    grant.wrapping_key,
    identityAad(scope.workspaceId, grant.identity_id)
  );
  const secret = await openEnvelope(
    identityKey,
    grant.wrapped_secret,
    delegateAad(grant.identity_id, handle, grant.id)
  );
  return new Secret(secret.toString("utf8"));
};
const requireWorkspaceMember = async function (scope: AccessScope) {
  const rows = await query(sql`SELECT 1 FROM workspace_memberships
      WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId} FOR SHARE`);
  if (!rows.length) throw new WorkspaceAccessDenied();
  return true;
};
const ensureAgentIdentity = async function (scope: AccessScope) {
  const existing = await query<{
    id: string;
    wrapping_key: string;
  }>(sql`SELECT id, wrapping_key FROM vault_agent_identities
    WHERE workspace_id = ${scope.workspaceId} AND revoked_at IS NULL FOR UPDATE`);
  const key = await installationKey();
  if (existing[0]) {
    const plaintext = await unwrapIdentityKey(
      key,
      existing[0].wrapping_key,
      identityAad(scope.workspaceId, existing[0].id)
    );
    return {
      id: existing[0].id,
      plaintext,
    };
  }
  const id = randomUUID();
  const plaintext = randomBytes(32);
  const wrappingKey = seal(
    key,
    plaintext.toString("base64"),
    identityAad(scope.workspaceId, id)
  );
  await query(sql`INSERT INTO vault_agent_identities(id, workspace_id, wrapping_key)
    VALUES (${id}, ${scope.workspaceId}, ${wrappingKey})`);
  return {
    id,
    plaintext,
  };
};
async function unwrapIdentityKey(
  installation: Buffer,
  wrappingKey: string,
  aad: string
) {
  const wrapped = await openEnvelope(installation, wrappingKey, aad);
  const plaintext = Buffer.from(wrapped.toString("utf8"), "base64");
  if (plaintext.length !== 32) throw new WorkspaceAccessDenied();
  return plaintext;
}
function identityAad(workspaceId: string, identityId: string) {
  return `vault-agent\u0000${workspaceId}\u0000${identityId}`;
}
function delegateAad(identityId: string, itemId: string, grantId: string) {
  return `vault-delegate\u0000${identityId}\u0000${itemId}\u0000${grantId}`;
}
function seal(key: Buffer, value: string, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}
async function openEnvelope(key: Buffer, value: string, aad: string) {
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext] =
      value.split(".");
    if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
      throw new Error("unsupported");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(encodedIv, "base64url")
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]);
  } catch {
    throw new WorkspaceAccessDenied();
  }
}

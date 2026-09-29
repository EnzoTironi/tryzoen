import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { vaultPageInputSchema } from "@zoen/companion-ui/vault";

import { vaultItemKindSchema } from "@zoen/companion-ui/vault";
import {
  loginAccountHint,
  parsePaymentCardSecret,
  parseLoginVaultPayload,
  paymentCardBrand,
  type VaultCreateItem,
} from "@zoen/companion-ui/vault";
import type { AccessScope } from "@shared/identity/access-scope";
import { query, transaction } from "@db/queries";
import {
  deleteEncryptedSecret,
  readEncryptedSecret,
  writeEncryptedSecret,
} from "@db/services/secrets";
import { ensureScope } from "@db/services/scope";
import { getInstallationSecrets } from "@db/services/installation-secrets";

const vaultRecordSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  id: z.string(),
  kind: vaultItemKindSchema,
  label: z.string(),
  updatedAt: z.string(),
});

type VaultRecord = z.infer<typeof vaultRecordSchema>;

const selection = sql`account, created_at AS "createdAt", id, kind, label, updated_at AS "updatedAt"`;
const vaultRows = vaultRecordSchema
  .extend({ createdAt: z.coerce.date(), updatedAt: z.coerce.date() })
  .transform(serializeVaultRecord)
  .array();

async function createVaultRecord(scope: AccessScope, record: VaultRecord) {
  await query(sql`INSERT INTO vault_items(id,workspace_id,kind,label,account,created_at,updated_at)
    VALUES (${record.id},${scope.workspaceId},${record.kind},${record.label},${record.account},${record.createdAt}::timestamptz,${record.updatedAt}::timestamptz)`);
}
export async function listVaultItems(scope: AccessScope) {
  return vaultRows.parse(
    await query(
      sql`SELECT ${selection} FROM vault_items WHERE workspace_id=${scope.workspaceId} ORDER BY updated_at DESC,id DESC`
    )
  );
}

export async function readVaultItems(scope: AccessScope) {
  await ensureScope(scope);
  const records = await listVaultItems(scope);
  return Promise.all(
    records.map(async (record) =>
      Object.assign(record, {
        hasSecret: await hasVaultSecret(scope, record.id),
      })
    )
  );
}
export async function readVaultPage(
  scope: AccessScope,
  input: z.infer<typeof vaultPageInputSchema>
) {
  const rows =
    await query(sql`SELECT ${selection}, EXISTS(SELECT 1 FROM encrypted_secrets s WHERE s.workspace_id=vault_items.workspace_id AND s.id=vault_items.id AND s.namespace='vault') AS "hasSecret" FROM vault_items WHERE workspace_id=${scope.workspaceId}
    ${input.kind ? sql`AND kind=${input.kind}` : sql``}
    ${input.cursor ? sql`AND (updated_at,id)<(${input.cursor.updatedAt}::timestamptz,${input.cursor.id})` : sql``}
    ORDER BY updated_at DESC,id DESC LIMIT 21`);
  const records = vaultRows.parse(rows);
  const items = records.slice(0, 20).map((record, index) =>
    Object.assign(record, {
      hasSecret: z.boolean().parse(rows[index]?.hasSecret),
    })
  );
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      records.length > 20 && last
        ? { updatedAt: last.updatedAt, id: last.id }
        : null,
  };
}

export async function readVaultItem(scope: AccessScope, id: string) {
  return vaultRows.parse(
    await query(
      sql`SELECT ${selection} FROM vault_items WHERE workspace_id=${scope.workspaceId} AND id=${id} LIMIT 1`
    )
  )[0];
}
export async function deleteVaultItem(scope: AccessScope, id: string) {
  return transaction(async () => {
    const rows = await query(
      sql`DELETE FROM vault_items WHERE workspace_id=${scope.workspaceId} AND id=${id} RETURNING id`
    );
    if (!rows.length) return false;
    await deleteEncryptedSecret(scope, id);
    return true;
  });
}
export async function saveVaultItem(
  scope: AccessScope,
  input: VaultCreateItem
) {
  await ensureScope(scope);
  const id = randomUUID();
  const now = new Date().toISOString();
  await transaction(async () => {
    await writeVaultSecret(scope, id, input.secret);
    await createVaultRecord(scope, {
      account: vaultAccountHint(input),
      createdAt: now,
      id,
      kind: input.kind,
      label: input.label,
      updatedAt: now,
    });
  });
}

export async function readVaultSecret(scope: AccessScope, id: string) {
  const encrypted = await readEncryptedSecret(scope, id);
  if (!encrypted) return undefined;
  const { secretEncryptionKey } = await getInstallationSecrets();
  return decryptVaultSecret(scope, id, encrypted, secretEncryptionKey);
}

export async function hasVaultSecret(scope: AccessScope, id: string) {
  return (await readEncryptedSecret(scope, id)) !== undefined;
}

async function writeVaultSecret(scope: AccessScope, id: string, value: string) {
  const { secretEncryptionKey } = await getInstallationSecrets();
  await writeEncryptedSecret(
    scope,
    id,
    encryptVaultSecret(scope, id, value, secretEncryptionKey)
  );
}

function vaultAccountHint(input: VaultCreateItem) {
  switch (input.kind) {
    case "login": {
      const payload = parseLoginVaultPayload(input.secret);
      if (!payload)
        throw new Error("The saved login is incomplete or invalid.");
      return loginAccountHint(
        payload.identifier,
        "origin" in payload ? payload.origin : undefined
      );
    }
    case "payment": {
      const card = parsePaymentCardSecret(input.secret);
      return `${paymentCardBrand(card.number)} · •••• ${card.number.slice(-4)}`;
    }
    case "address":
    case "contact":
      return "";
  }
  throw new Error("Unsupported vault item kind.");
}

function encryptVaultSecret(
  scope: AccessScope,
  id: string,
  value: string,
  secretEncryptionKey: string
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(secretEncryptionKey, "base64"),
    iv
  );
  cipher.setAAD(vaultSecretAad(scope, id));
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

function decryptVaultSecret(
  scope: AccessScope,
  id: string,
  value: string,
  secretEncryptionKey: string
) {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("The stored secret uses an unsupported format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(secretEncryptionKey, "base64"),
    Buffer.from(encodedIv, "base64url")
  );
  decipher.setAAD(vaultSecretAad(scope, id));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function vaultSecretAad(scope: AccessScope, id: string) {
  return Buffer.from(`${scope.workspaceId}\u0000vault\u0000${id}`);
}

function serializeVaultRecord<T extends { createdAt: Date; updatedAt: Date }>(
  record: T
) {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

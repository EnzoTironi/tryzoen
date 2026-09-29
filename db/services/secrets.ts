import { sql } from "drizzle-orm";
import type { AccessScope } from "@shared/identity/access-scope";
import { query } from "@db/queries";
export async function writeEncryptedSecret(
  scope: AccessScope,
  id: string,
  encryptedValue: string
) {
  await query(sql`INSERT INTO encrypted_secrets(workspace_id,namespace,id,encrypted_value,updated_at)
    VALUES (${scope.workspaceId},'vault',${id},${encryptedValue},clock_timestamp())
    ON CONFLICT (workspace_id,namespace,id) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value,updated_at=EXCLUDED.updated_at`);
}
export async function readEncryptedSecret(scope: AccessScope, id: string) {
  const rows = await query<{ encryptedValue: string }>(
    sql`SELECT encrypted_value AS "encryptedValue" FROM encrypted_secrets WHERE workspace_id=${scope.workspaceId} AND namespace='vault' AND id=${id} LIMIT 1`
  );
  return rows[0]?.encryptedValue;
}
export async function deleteEncryptedSecret(scope: AccessScope, id: string) {
  await query(
    sql`DELETE FROM encrypted_secrets WHERE workspace_id=${scope.workspaceId} AND namespace='vault' AND id=${id}`
  );
}

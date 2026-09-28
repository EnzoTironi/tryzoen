import { createHash } from "node:crypto";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@db/services/auth";
import { z } from "zod";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../../workspaces/access";

export const syncCursorSchema = z.object({
  purpose: z.literal("matrix-inbox-sync-v1"),
  userId: z.string(),
  sessionId: z.string(),
  workspaceId: z.string(),
  serverName: z.string(),
  selection: z.string(),
  head: z.string(),
  nextBatch: z.string().max(4096).nullable(),
  scope: z
    .array(z.object({ id: z.uuid(), roomId: z.string(), epoch: z.string() }))
    .max(31),
  expiresAt: z.number().int(),
});
export function syncFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export async function sealSyncCursor(value: z.infer<typeof syncCursorSchema>) {
  const auth = await getAuth();
  return symmetricEncrypt({
    key: (await auth.$context).secretConfig,
    data: JSON.stringify(syncCursorSchema.parse(value)),
  });
}
export async function openSyncCursor(
  actor: z.infer<typeof WorkspaceActorSchema>,
  serverName: string,
  cursor?: string
) {
  if (!cursor) return null;
  const auth = await getAuth();
  const key = (await auth.$context).secretConfig;
  let value: z.infer<typeof syncCursorSchema>;
  try {
    value = syncCursorSchema.parse(
      JSON.parse(await symmetricDecrypt({ key, data: cursor }))
    );
  } catch {
    throw new WorkspaceAccessDenied();
  }
  if (
    value.userId !== actor.userId ||
    value.sessionId !== actor.authSessionId ||
    value.workspaceId !== actor.workspaceId ||
    value.serverName !== serverName
  )
    throw new WorkspaceAccessDenied();
  return value.expiresAt > Date.now() ? value : null;
}

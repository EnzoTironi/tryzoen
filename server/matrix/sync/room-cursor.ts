import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@db/services/auth";
import { z } from "zod";
import { MatrixError } from "../client";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../../workspaces/access";

const cursorSchema = z.object({
  purpose: z.literal("matrix-room-sync-v1"),
  userId: z.string(),
  sessionId: z.string(),
  workspaceId: z.string(),
  roomId: z.string(),
  epoch: z.string(),
  nextBatch: z.string().max(4096),
  issuedAt: z.number().int(),
  userIds: z.array(z.string().max(255)).max(100),
  expiresAt: z.number().int().nonnegative(),
});
export async function sealRoomSyncCursor(value: z.infer<typeof cursorSchema>) {
  const cursor = await symmetricEncrypt({
    key: (await (await getAuth()).$context).secretConfig,
    data: JSON.stringify(cursorSchema.parse(value)),
  });
  if (cursor.length > 16384) throw new MatrixError({ reason: "unavailable" });
  return cursor;
}
export async function openRoomSyncCursor(
  actor: z.infer<typeof WorkspaceActorSchema>,
  cursor?: string
) {
  if (!cursor) return null;
  let value: z.infer<typeof cursorSchema>;
  try {
    value = cursorSchema.parse(
      JSON.parse(
        await symmetricDecrypt({
          key: (await (await getAuth()).$context).secretConfig,
          data: cursor,
        })
      )
    );
  } catch {
    throw new WorkspaceAccessDenied();
  }
  if (
    value.userId !== actor.userId ||
    value.sessionId !== actor.authSessionId ||
    value.workspaceId !== actor.workspaceId
  )
    throw new WorkspaceAccessDenied();
  return Date.now() - value.issuedAt < 86_400_000 ? value : null;
}

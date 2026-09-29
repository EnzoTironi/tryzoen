import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@db/services/auth";
import { z } from "zod";
import { WorkspaceAccessDenied } from "../../workspaces/access";

const cursorSchema = z.object({
  purpose: z.literal("matrix-room-search-v1"),
  scope: z.string(),
  nextBatch: z.string().min(1).max(4096),
  expiresAt: z.number().int(),
});
export async function openSearchCursor(scope: string, cursor?: string) {
  if (!cursor) return undefined;
  const auth = await getAuth();
  try {
    const value = cursorSchema.parse(
      JSON.parse(
        await symmetricDecrypt({
          key: (await auth.$context).secretConfig,
          data: cursor,
        })
      )
    );
    if (value.scope !== scope || value.expiresAt <= Date.now())
      throw new WorkspaceAccessDenied();
    return value.nextBatch;
  } catch {
    throw new WorkspaceAccessDenied();
  }
}
export async function sealSearchCursor(scope: string, nextBatch: string) {
  const auth = await getAuth();
  return symmetricEncrypt({
    key: (await auth.$context).secretConfig,
    data: JSON.stringify(
      cursorSchema.parse({
        purpose: "matrix-room-search-v1",
        scope,
        nextBatch,
        expiresAt: Date.now() + 15 * 60_000,
      })
    ),
  });
}

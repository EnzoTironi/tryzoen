import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import { roomPresencePreferenceSchema } from "@zoen/companion-ui/rooms";
import type { z } from "zod";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { MatrixError, matrixRequest } from "./client";
import { ensureMatrixIdentity } from "./identities";
import { requireMatrixRoom } from "./rooms";

const preferencePath = (id: string) =>
  `user/${encodeURIComponent(id)}/account_data/io.zoen.presence`;

async function readPreference(matrixId: string) {
  try {
    return roomPresencePreferenceSchema.parse(
      await matrixRequest(
        "GET",
        preferencePath(matrixId),
        undefined,
        matrixId,
        { maxResponseBytes: 1024 }
      )
    );
  } catch (error) {
    if (error instanceof MatrixError && error.reason === "not-found")
      return { sharing: false };
    throw error;
  }
}

/** Native account data owns this choice across all of the person's conversations/devices. */
export async function readPresencePreference(
  actor: z.infer<typeof WorkspaceActorSchema>,
  roomId: string
) {
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
  await requireMatrixRoom(actor, roomId);
  const result = await readPreference(await ensureMatrixIdentity(actor));
  await requireMatrixRoom(actor, roomId);
  return result;
}

/** Serialize publication and privacy changes, but never hold this lock during long-polling. */
export async function updateMatrixPresence(
  actor: z.infer<typeof WorkspaceActorSchema>,
  roomId: string,
  sharing?: boolean
) {
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
  return transaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`matrix-presence:${actor.userId}`}, 0))`
    );
    await requireMatrixRoom(actor, roomId);
    const matrixId = await ensureMatrixIdentity(actor);
    const preference =
      sharing === undefined ? await readPreference(matrixId) : { sharing };
    if (sharing !== undefined)
      await matrixRequest(
        "PUT",
        preferencePath(matrixId),
        preference,
        matrixId
      );
    // Persist opting out before suppressing presence. A failed publication cannot re-enable it.
    if (preference.sharing || sharing === false)
      await matrixRequest(
        "PUT",
        `presence/${encodeURIComponent(matrixId)}/status`,
        { presence: preference.sharing ? "online" : "offline" },
        matrixId
      );
    return preference;
  });
}

import { sql } from "drizzle-orm";
import type { z } from "zod";
import { query, transaction } from "@db/queries";
import { roomCreateSchema, roomRenameSchema } from "@zoen/companion-ui/rooms";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { MatrixError, matrixRequest } from "./client";
import { requireMatrixRoom } from "./rooms";

/** Preserve the existing admin boundary and native room identity while changing its name. */
export function renameMatrixRoom(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomRenameSchema>
) {
  const input = roomRenameSchema.parse(raw);
  return transaction(async () => {
    // Use the membership lock too: both operations update this binding.
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.id}, 5))`
    );
    const room = await requireMatrixRoom(actor, input.id, true);
    if (room.label === input.name) return { status: "saved" as const, room };
    if (room.label !== input.expectedName)
      return { status: "conflict" as const, room };
    const path = `rooms/${encodeURIComponent(room.roomId)}/state/m.room.name`;
    await matrixRequest("PUT", path, { name: input.name });
    const saved = roomCreateSchema.pick({ name: true }).parse(
      await matrixRequest("GET", path, undefined, undefined, {
        maxResponseBytes: 8192,
      })
    );
    if (saved.name !== input.name)
      throw new MatrixError({ reason: "conflict" });
    await requireMatrixRoom(actor, input.id, true);
    await query(sql`UPDATE workspace_group_bindings SET label = ${saved.name}
      WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId}`);
    return {
      status: "saved" as const,
      room: await requireMatrixRoom(actor, input.id, true),
    };
  });
}

import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { readCreatorDraft } from "./drafts";
import { requireActiveCreatorPilot } from "./pilots";

export async function requirePreview(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  const [owned] =
    await query(sql`SELECT draft_id AS "draftId", pilot_id AS "pilotId" FROM creator_previews
    WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
  if (!owned) throw new WorkspaceAccessDenied();
  const source = z
    .object({ draftId: z.uuid(), pilotId: z.uuid().nullable() })
    .parse(owned);
  if (source.pilotId) await requireActiveCreatorPilot(actor, source.pilotId);
  else await readCreatorDraft(actor, source.draftId);
}

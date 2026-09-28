import { query } from "../../../db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { creatorDraftSaveSchema } from "@zoen/companion-ui/creators";
import type { WorkspaceActorSchema } from "../../workspaces/access";
import { creatorSourceExample, creatorSourceSchema } from "./schema";

/** Managed source examples retain their reviewed bytes and attribution across edits. */
export async function validateCreatorSourceExamples(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof creatorDraftSaveSchema>
) {
  if (!input.content.examples.length) return;
  const ids = JSON.stringify(
    input.content.examples.map((example) => example.id)
  );
  const rows =
    await query(sql`SELECT id,draft_id AS "draftId",revision,snapshot,status,rights,
    workspace_id AS "workspaceId",user_id AS "userId",
    to_char(acquired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "acquiredAt",
    to_char(reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "reviewedAt",
    to_char(withdrawn_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "withdrawnAt"
    FROM creator_sources WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId} AND draft_id = ${input.id} AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb))`);
  for (const row of rows) {
    const source = creatorSourceSchema
      .extend({ workspaceId: z.string(), userId: z.string() })
      .parse(row);
    if (
      source.workspaceId !== actor.workspaceId ||
      source.userId !== actor.userId ||
      source.draftId !== input.id ||
      source.status !== "reviewed" ||
      JSON.stringify(
        input.content.examples.find((example) => example.id === source.id)
      ) !== JSON.stringify(creatorSourceExample(source))
    )
      throw new Error(
        "An imported source was withdrawn or changed. Review the source again; its attribution cannot be edited as an authored example."
      );
  }
}

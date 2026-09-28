import { randomUUID } from "node:crypto";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import {
  creatorPreviewReviewSaveSchema,
  creatorPreviewReviewSchema,
} from "@zoen/companion-ui/creators";
import type { z } from "zod";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { requirePreview } from "./previews";

export class CreatorReviewConflict extends Error {
  constructor() {
    super(
      "This review changed elsewhere. Reopen it before saving your changes."
    );
    this.name = "CreatorReviewConflict";
  }
}

export function saveCreatorPreviewReview(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorPreviewReviewSaveSchema>
) {
  const input = creatorPreviewReviewSaveSchema.parse(raw);
  return transaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["creator-previews", actor.workspaceId, actor.userId])}, 0))`
    );
    await requirePreview(actor, input.id);
    const [current] = await query<{
      revision: string | null;
      same: boolean;
    }>(sql`
      SELECT review_revision AS revision, review = ${JSON.stringify(input.content)}::jsonb AS same
      FROM creator_previews WHERE id = ${input.id} AND status = 'completed' FOR UPDATE`);
    if (!current) throw new Error("Only a completed preview can be reviewed.");
    // Preserve the revision on a response-loss retry only while that content is current.
    if (!current.same) {
      if (current.revision !== input.expectedRevision)
        throw new CreatorReviewConflict();
      await query(sql`UPDATE creator_previews SET review = ${JSON.stringify(input.content)}::jsonb,
        review_revision = ${randomUUID()}, reviewed_at = clock_timestamp() WHERE id = ${input.id}`);
    }
    const [saved] =
      await query(sql`SELECT review_revision AS revision, review AS content,
      extract(epoch FROM reviewed_at)::float8 * 1000 AS "updatedAt" FROM creator_previews WHERE id = ${input.id}`);
    return creatorPreviewReviewSchema.parse(saved);
  });
}

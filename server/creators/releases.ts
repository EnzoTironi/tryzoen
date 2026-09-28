import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import {
  creatorReleaseListSchema,
  creatorReleaseRequestSchema,
  creatorReleaseSchema,
} from "@zoen/companion-ui/creators";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { readCreatorDraft, requireCreator } from "./drafts";
import { readCreatorReleaseCandidate } from "./release-candidate";

const projection = sql`id, draft_id AS "draftId", revision, evaluation_revision AS "evaluationRevision", notes,
  extract(epoch FROM created_at)::float8 * 1000 AS "createdAt"`;

export function listCreatorReleases(
  actor: z.infer<typeof WorkspaceActorSchema>,
  draftId: string
) {
  return transaction(async () => {
    await readCreatorDraft(actor, draftId);
    return creatorReleaseListSchema.parse(
      await query(sql`SELECT ${projection} FROM creator_releases
      WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId} AND draft_id = ${draftId}
      ORDER BY created_at DESC, id DESC LIMIT 50`)
    );
  });
}

export function readCreatorRelease(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  return transaction(async () => {
    await requireCreator(actor);
    const [row] =
      await query(sql`SELECT ${projection}, content, evidence FROM creator_releases
      WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    if (!row) throw new WorkspaceAccessDenied();
    return creatorReleaseSchema.parse(row);
  });
}

export function approveCreatorRelease(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorReleaseRequestSchema>
) {
  const input = creatorReleaseRequestSchema.parse(raw);
  return transaction(async () => {
    // Same order for all release writes: draft edits, then preview admission/reviews.
    // Both locks precede live membership locks so revocation remains authoritative.
    for (const domain of ["creator-drafts", "creator-previews"])
      await query(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([domain, actor.workspaceId, actor.userId])}, 0))`
      );
    await requireCreator(actor);
    const [existing] =
      await query(sql`SELECT ${projection}, content, evidence FROM creator_releases
      WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    if (existing) {
      const saved = creatorReleaseSchema.parse(existing);
      const receipt = creatorReleaseRequestSchema.strip().parse({
        ...saved,
        evidence: saved.evidence.map((item) => ({
          id: item.id,
          reviewRevision: item.review.revision,
        })),
      });
      if (JSON.stringify(receipt) !== JSON.stringify(input))
        throw new Error(
          "This approval was already saved with different content."
        );
      return saved;
    }
    const candidate = await readCreatorReleaseCandidate(actor, input.draftId);
    if (candidate.issues.length) throw new Error(candidate.issues.join("\n"));
    if (
      candidate.draft.revision !== input.revision ||
      candidate.draft.evaluation?.revision !== input.evaluationRevision ||
      JSON.stringify(
        candidate.evidence.map((item) => ({
          id: item.id,
          reviewRevision: item.review.revision,
        }))
      ) !== JSON.stringify(input.evidence)
    )
      throw new Error(
        "The draft or its evaluations changed. Reopen the version review before approving it."
      );
    const [capacity] = await query<{
      count: number;
    }>(sql`SELECT count(*)::int AS count FROM creator_releases
      WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    if (!capacity || capacity.count >= 50)
      throw new Error(
        "You can retain up to 50 approved versions in this workspace."
      );
    const [created] =
      await query(sql`INSERT INTO creator_releases (id, workspace_id, user_id, draft_id, revision, evaluation_revision, content, evidence, notes)
      VALUES (${input.id}, ${actor.workspaceId}, ${actor.userId}, ${input.draftId}, ${input.revision}, ${input.evaluationRevision},
      ${JSON.stringify(candidate.draft.content)}::jsonb, ${JSON.stringify(candidate.evidence)}::jsonb, ${input.notes})
      ON CONFLICT (id) DO NOTHING RETURNING id`);
    if (!created) throw new WorkspaceAccessDenied();
    return readCreatorRelease(actor, input.id);
  });
}

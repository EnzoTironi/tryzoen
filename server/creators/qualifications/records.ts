import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { creatorQualificationSchema } from "@zoen/companion-ui/creators";
import { requireCreator } from "../drafts";
import { readCreatorRelease } from "../releases";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../../workspaces/access";
const projection = sql`q.id,q.release_id AS "releaseId",q.manifest_digest AS "manifestDigest",q.evaluation_revision AS "evaluationRevision",q.evidence,q.notes,extract(epoch FROM q.created_at)::float8*1000 AS "createdAt"`;

export function readCreatorQualification(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  return transaction(async () => {
    await requireCreator(actor);
    const [row] = await query(
      sql`SELECT ${projection} FROM creator_qualifications q JOIN creator_releases r ON r.id=q.release_id WHERE q.id=${id} AND r.workspace_id=${actor.workspaceId} AND r.user_id=${actor.userId} FOR SHARE OF q`
    );
    if (!row) throw new WorkspaceAccessDenied();
    return creatorQualificationSchema.parse(row);
  });
}
export function listCreatorQualifications(
  actor: z.infer<typeof WorkspaceActorSchema>,
  releaseId: string
) {
  return transaction(async () => {
    await readCreatorRelease(actor, releaseId);
    const rows = await query(
      sql`SELECT q.id,q.release_id AS "releaseId",q.manifest_digest AS "manifestDigest",q.evaluation_revision AS "evaluationRevision",q.notes,extract(epoch FROM q.created_at)::float8*1000 AS "createdAt",jsonb_array_length(q.evidence) AS cases FROM creator_qualifications q WHERE q.release_id=${releaseId} ORDER BY q.created_at DESC,q.id DESC LIMIT 50`
    );
    return creatorQualificationSchema
      .omit({ evidence: true })
      .extend({ cases: z.number().int().min(2).max(20) })
      .array()
      .max(50)
      .parse(rows);
  });
}

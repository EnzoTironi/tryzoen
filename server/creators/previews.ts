import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  creatorDraftContentSchema,
  creatorPreviewListSchema,
  creatorPreviewRequestSchema,
  creatorPreviewSchema,
  creatorPreviewExportSchema,
} from "@zoen/companion-ui/creators";
import { CreatorDraftConflict, readCreatorDraft } from "./drafts";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";

const projection = sql`id, draft_id AS "draftId", revision, question, snapshot->>'title' AS title,
  CASE WHEN status IN ('pending', 'running') AND expires_at <= now() THEN 'expired' ELSE status END AS status,
  response, extract(epoch FROM created_at)::float8 * 1000 AS "createdAt", extract(epoch FROM expires_at)::float8 * 1000 AS "expiresAt"`;

async function requirePreview(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  const [owned] =
    await query(sql`SELECT draft_id AS "draftId" FROM creator_previews
    WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
  if (!owned) throw new WorkspaceAccessDenied();
  await readCreatorDraft(
    actor,
    z.object({ draftId: z.uuid() }).parse(owned).draftId
  );
}

export function exportCreatorPreview(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  return transaction(async () => {
    await requirePreview(actor, id);
    const [row] = await query(
      sql`SELECT ${projection}, snapshot FROM creator_previews WHERE id = ${id}`
    );
    return creatorPreviewExportSchema.parse(row);
  });
}

export function listCreatorPreviews(
  actor: z.infer<typeof WorkspaceActorSchema>,
  draftId: string
) {
  return transaction(async () => {
    await readCreatorDraft(actor, draftId);
    return creatorPreviewListSchema.parse(
      await query(sql`SELECT ${projection} FROM creator_previews
      WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId} AND draft_id = ${draftId}
      ORDER BY created_at DESC, id DESC LIMIT 20`)
    );
  });
}

export function createCreatorPreview(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorPreviewRequestSchema>
) {
  const input = creatorPreviewRequestSchema.parse(raw);
  return transaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["creator-previews", actor.workspaceId, actor.userId])}, 0))`
    );
    const draft = await readCreatorDraft(actor, input.draftId);
    const existing =
      await query(sql`SELECT ${projection} FROM creator_previews WHERE id = ${input.id}
      AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    if (existing[0]) {
      const preview = creatorPreviewSchema.parse(existing[0]);
      if (
        preview.draftId !== input.draftId ||
        preview.revision !== input.revision ||
        preview.question !== input.question
      )
        throw new CreatorDraftConflict();
      return preview;
    }
    if (draft.archivedAt || draft.revision !== input.revision)
      throw new CreatorDraftConflict();
    if (Buffer.byteLength(JSON.stringify(draft.content), "utf8") > 48000)
      throw new Error(
        "For a preview, shorten the playbook and examples to a combined 48 KB. Nothing will be silently omitted."
      );
    const [capacity] = await query<{
      total: number;
      today: number;
      active: number;
    }>(sql`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today,
      count(*) FILTER (WHERE status IN ('pending', 'running') AND expires_at > now())::int AS active
      FROM creator_previews WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    if (
      !capacity ||
      capacity.total >= 100 ||
      capacity.today >= 10 ||
      capacity.active
    )
      throw new Error(
        "You can run one preview at a time, up to 10 in 24 hours and 100 saved previews in this workspace. A pending preview expires after five minutes."
      );
    const rows =
      await query(sql`INSERT INTO creator_previews (id, workspace_id, user_id, draft_id, revision, snapshot, question)
      VALUES (${input.id}, ${actor.workspaceId}, ${actor.userId}, ${input.draftId}, ${input.revision}, ${JSON.stringify(draft.content)}::jsonb, ${input.question})
      ON CONFLICT (id) DO NOTHING RETURNING ${projection}`);
    if (!rows[0]) throw new WorkspaceAccessDenied();
    return creatorPreviewSchema.parse(rows[0]);
  });
}

export function claimCreatorPreview(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string,
  invocation: string
) {
  return transaction(async () => {
    await requirePreview(actor, id);
    // Only the workflow invocation that first claims this request may execute it.
    // A competing invocation cannot duplicate a provider call, even after a crash.
    const [claimed] =
      await query(sql`UPDATE creator_previews SET status = 'running', invocation = ${invocation}
      WHERE id = ${id} AND status = 'pending' AND expires_at > now()
      RETURNING snapshot, question`);
    if (!claimed)
      throw new Error(
        "This preview has already started or expired. Open its saved result in Creator studio."
      );
    return z
      .object({
        snapshot: creatorDraftContentSchema,
        question: creatorPreviewRequestSchema.shape.question,
      })
      .parse(claimed);
  });
}

export function finishCreatorPreview(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string,
  invocation: string,
  response: string | null
) {
  const answer = z.string().trim().min(1).max(32000).nullable().parse(response);
  return transaction(async () => {
    await requirePreview(actor, id);
    // Completion retries are safe. Late results never turn an expired request into a success.
    const updated =
      await query(sql`UPDATE creator_previews SET status = ${answer === null ? "failed" : "completed"}, response = ${answer}
      WHERE id = ${id} AND invocation = ${invocation} AND status = 'running' AND expires_at > now() RETURNING id`);
    return { recorded: updated.length > 0 };
  });
}

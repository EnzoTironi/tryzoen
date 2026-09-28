import { creatorPreviewProjection } from "./preview-record";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  creatorDraftContentSchema,
  type creatorDraftSchema,
  creatorPreviewListSchema,
  creatorPreviewRequestSchema,
  creatorPreviewSchema,
  creatorPreviewExportSchema,
} from "@zoen/companion-ui/creators";
import { CreatorDraftConflict, readCreatorDraft } from "./drafts";
import { creatorPreviewOriginSchema } from "./execution";
import { requirePreview } from "./preview-access";
import { requireActiveCreatorPilot } from "./pilots";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";

export function exportCreatorPreview(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  return transaction(async () => {
    await requirePreview(actor, id);
    const [row] = await query(
      sql`SELECT ${creatorPreviewProjection}, snapshot FROM creator_previews WHERE id = ${id}`
    );
    return creatorPreviewExportSchema.parse(row);
  });
}

export function listCreatorPreviews(
  actor: z.infer<typeof WorkspaceActorSchema>,
  draftId: string,
  pilotId?: string
) {
  return transaction(async () => {
    if (pilotId) {
      const pilot = await requireActiveCreatorPilot(actor, pilotId);
      if (pilot.draftId !== draftId) throw new WorkspaceAccessDenied();
    } else await readCreatorDraft(actor, draftId);
    return creatorPreviewListSchema.parse(
      await query(sql`SELECT ${creatorPreviewProjection} FROM creator_previews
      WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId} AND draft_id = ${draftId}
      AND pilot_id IS NOT DISTINCT FROM ${pilotId ?? null}::uuid
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
    const sources = await readPreviewSources(actor, input);
    const existing =
      await query(sql`SELECT ${creatorPreviewProjection} FROM creator_previews WHERE id = ${input.id}
      AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    if (existing[0]) {
      const preview = creatorPreviewSchema.parse(existing[0]);
      if (
        preview.draftId !== input.draftId ||
        preview.revision !== input.revision ||
        preview.kind !== input.kind ||
        preview.question !== input.question ||
        preview.pilotId !== (input.pilotId ?? null) ||
        (preview.evaluation?.case.id ?? null) !== (input.caseRef?.id ?? null) ||
        (preview.evaluation?.revision ?? null) !==
          (input.caseRef?.revision ?? null)
      )
        throw new CreatorDraftConflict();
      return preview;
    }
    const { snapshot, evaluation } =
      sources.kind === "draft"
        ? selectPreviewSources(sources.draft, input)
        : sources;
    if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 48000)
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
      await query(sql`INSERT INTO creator_previews (id, workspace_id, user_id, draft_id, pilot_id, revision, kind, snapshot, question, evaluation)
      VALUES (${input.id}, ${actor.workspaceId}, ${actor.userId}, ${input.draftId}, ${input.pilotId ?? null}, ${input.revision}, ${input.kind}, ${JSON.stringify(snapshot)}::jsonb, ${input.question}, ${evaluation ? JSON.stringify(evaluation) : null}::jsonb)
      ON CONFLICT (id) DO NOTHING RETURNING ${creatorPreviewProjection}`);
    if (!rows[0]) throw new WorkspaceAccessDenied();
    return creatorPreviewSchema.parse(rows[0]);
  });
}

async function readPreviewSources(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof creatorPreviewRequestSchema>
) {
  if (!input.pilotId) {
    const draft = await readCreatorDraft(actor, input.draftId);
    // Retry validation must preserve the original result even after the draft changes.
    return { kind: "draft" as const, draft };
  }
  const pilot = await requireActiveCreatorPilot(actor, input.pilotId);
  if (
    input.kind !== "answer" ||
    input.caseRef ||
    input.draftId !== pilot.draftId ||
    input.revision !== pilot.revision
  )
    throw new WorkspaceAccessDenied();
  return { kind: "pilot" as const, snapshot: pilot.content, evaluation: null };
}

function selectPreviewSources(
  draft: z.infer<typeof creatorDraftSchema>,
  input: z.infer<typeof creatorPreviewRequestSchema>
) {
  if (draft.archivedAt || draft.revision !== input.revision)
    throw new CreatorDraftConflict();
  if (
    input.kind === "playbook" &&
    (input.caseRef || !draft.content.examples.length)
  )
    throw new Error(
      "Playbook proposals need authored examples and cannot use evaluation cases."
    );
  const snapshot =
    input.kind === "playbook"
      ? { ...draft.content, playbook: "" }
      : draft.content;
  const evaluationCase =
    input.caseRef &&
    draft.evaluation?.cases.find((item) => item.id === input.caseRef?.id);
  if (
    input.caseRef &&
    (!evaluationCase ||
      draft.evaluation?.revision !== input.caseRef.revision ||
      evaluationCase.question !== input.question)
  )
    throw new CreatorDraftConflict();
  const evaluation =
    evaluationCase && draft.evaluation
      ? { revision: draft.evaluation.revision, case: evaluationCase }
      : null;
  return { snapshot, evaluation };
}

export function claimCreatorPreview(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string,
  invocation: string,
  source: z.infer<typeof creatorPreviewOriginSchema>
) {
  const origin = creatorPreviewOriginSchema.parse(source);
  return transaction(async () => {
    await requirePreview(actor, id);
    // Only the workflow invocation that first claims this request may execute it.
    // A competing invocation cannot duplicate a provider call, even after a crash.
    const [claimed] =
      await query(sql`UPDATE creator_previews SET status = 'running', invocation = ${invocation}, started_at = clock_timestamp(), source_session_id = ${origin.sessionId}, source_turn_id = ${origin.turnId}
      WHERE id = ${id} AND status = 'pending' AND expires_at > now()
      RETURNING snapshot, question, kind`);
    if (!claimed)
      throw new Error(
        "This preview has already started or expired. Open its saved result in Creator studio."
      );
    return z
      .object({
        snapshot: creatorDraftContentSchema,
        question: creatorPreviewRequestSchema.shape.question,
        kind: creatorPreviewRequestSchema.shape.kind,
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
      await query(sql`UPDATE creator_previews SET status = ${answer === null ? "failed" : "completed"}, response = ${answer}, finished_at = clock_timestamp()
      WHERE id = ${id} AND invocation = ${invocation} AND status = 'running' AND expires_at > now() RETURNING id`);
    return { recorded: updated.length > 0 };
  });
}

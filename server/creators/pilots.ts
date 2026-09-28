import { randomUUID } from "node:crypto";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import {
  creatorPilotActionSchema,
  creatorPilotInviteSchema,
  creatorPilotListSchema,
  creatorPilotSchema,
  creatorPilotTeachingSchema,
  creatorPilotFeedbackSaveSchema,
  creatorPilotFeedbackViewSchema,
} from "@zoen/companion-ui/creators";
import { requireCreator } from "./drafts";
import { readCreatorRelease } from "./releases";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";

function pilotProjection(actor: z.infer<typeof WorkspaceActorSchema>) {
  return sql`p.id, p.release_id AS "releaseId", r.draft_id AS "draftId", r.revision,
    r.content->>'title' AS title, r.content->>'description' AS description,
    author.name AS "creatorName", recipient.name AS "recipientName",
    p.creator_user_id = ${actor.userId} AS "isCreator", p.status,
    extract(epoch FROM p.created_at)::float8 * 1000 AS "createdAt"`;
}

const pilotJoins = sql`FROM creator_pilots p
  JOIN creator_releases r ON r.id = p.release_id AND r.workspace_id = p.workspace_id AND r.user_id = p.creator_user_id
  JOIN workspaces w ON w.id = p.workspace_id
  JOIN organization_memberships creator_org ON creator_org.organization_id = w.organization_id AND creator_org.user_id = p.creator_user_id
  JOIN organization_memberships recipient_org ON recipient_org.organization_id = w.organization_id AND recipient_org.user_id = p.recipient_user_id
  JOIN public.user author ON ('better-auth:' || author.id) = p.creator_user_id
  JOIN public.user recipient ON ('better-auth:' || recipient.id) = p.recipient_user_id`;

export function listCreatorPilots(actor: z.infer<typeof WorkspaceActorSchema>) {
  return transaction(async () => {
    await requireCreator(actor);
    return creatorPilotListSchema.parse(
      await query(sql`SELECT ${pilotProjection(actor)} ${pilotJoins}
      WHERE p.workspace_id = ${actor.workspaceId} AND (p.creator_user_id = ${actor.userId} OR p.recipient_user_id = ${actor.userId})
      ORDER BY p.created_at DESC, p.id DESC LIMIT 100`)
    );
  });
}

export function readCreatorPilot(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  return transaction(async () => {
    await requireCreator(actor);
    const [row] =
      await query(sql`SELECT ${pilotProjection(actor)}, r.content ${pilotJoins}
      WHERE p.id = ${id} AND p.workspace_id = ${actor.workspaceId}
      AND (p.creator_user_id = ${actor.userId} OR (p.recipient_user_id = ${actor.userId} AND p.status = 'active'))
      FOR SHARE OF p, creator_org, recipient_org`);
    if (!row) throw new WorkspaceAccessDenied();
    return creatorPilotTeachingSchema.parse(row);
  });
}

/** Execution always checks the named participant's current access under a row lock. */
export async function requireActiveCreatorPilot(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  const pilot = await readCreatorPilot(actor, id);
  if (pilot.isCreator || pilot.status !== "active")
    throw new WorkspaceAccessDenied();
  return pilot;
}

export function inviteCreatorPilot(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorPilotInviteSchema>
) {
  const input = creatorPilotInviteSchema.parse(raw);
  return transaction(async () => {
    // Serialize admission for the workspace so received and sent limits are both exact.
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["creator-pilots", actor.workspaceId])}, 0))`
    );
    const release = await readCreatorRelease(actor, input.releaseId);
    const [target] = await query<{
      userId: string;
    }>(sql`SELECT m.user_id AS "userId" FROM user_directory d
      JOIN workspace_memberships m ON m.user_id = ('better-auth:' || d.user_id) AND m.workspace_id = ${actor.workspaceId}
      JOIN workspaces w ON w.id = m.workspace_id
      JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = m.user_id
      WHERE d.username = ${input.username} AND m.user_id <> ${actor.userId}
      AND NOT EXISTS (SELECT 1 FROM account_archive a WHERE a.source_user_id = d.user_id)
      FOR SHARE OF m, o`);
    if (!target)
      throw new Error(
        "Choose a person with a username who is already a member of this shared workspace. Personal spaces cannot host shared pilots."
      );
    const [existing] = await query<{
      releaseId: string;
      recipientUserId: string;
    }>(sql`SELECT release_id AS "releaseId", recipient_user_id AS "recipientUserId"
      FROM creator_pilots WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId} AND creator_user_id = ${actor.userId}`);
    if (existing) {
      if (
        existing.releaseId !== release.id ||
        existing.recipientUserId !== target.userId
      )
        throw new Error(
          "This invitation was already saved for different teaching or a different person."
        );
      return readCreatorPilot(actor, input.id);
    }
    const [capacity] = await query<{
      release: number;
      sender: number;
      recipient: number;
    }>(sql`SELECT
      count(*) FILTER (WHERE release_id = ${release.id})::int AS release,
      count(*) FILTER (WHERE creator_user_id = ${actor.userId} OR recipient_user_id = ${actor.userId})::int AS sender,
      count(*) FILTER (WHERE creator_user_id = ${target.userId} OR recipient_user_id = ${target.userId})::int AS recipient
      FROM creator_pilots WHERE workspace_id = ${actor.workspaceId} AND (release_id = ${release.id}
      OR creator_user_id IN (${actor.userId}, ${target.userId}) OR recipient_user_id IN (${actor.userId}, ${target.userId}))`);
    if (
      !capacity ||
      capacity.release >= 20 ||
      capacity.sender >= 100 ||
      capacity.recipient >= 100
    )
      throw new Error(
        "Pilot capacity reached: up to 20 invitations per approved version and 100 per person in this workspace, including closed pilots."
      );
    const [duplicate] = await query(
      sql`SELECT id FROM creator_pilots WHERE release_id = ${release.id} AND recipient_user_id = ${target.userId} AND status IN ('pending', 'active')`
    );
    if (duplicate)
      throw new Error(
        "This person already has a pending or active pilot for this version."
      );
    const [inserted] =
      await query(sql`INSERT INTO creator_pilots (id, release_id, workspace_id, creator_user_id, recipient_user_id)
      VALUES (${input.id}, ${release.id}, ${actor.workspaceId}, ${actor.userId}, ${target.userId}) ON CONFLICT (id) DO NOTHING RETURNING id`);
    if (!inserted) throw new WorkspaceAccessDenied();
    return readCreatorPilot(actor, input.id);
  });
}

export function actOnCreatorPilot(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorPilotActionSchema>
) {
  const input = creatorPilotActionSchema.parse(raw);
  return transaction(async () => {
    await requireCreator(actor);
    const [row] = await query(sql`SELECT ${pilotProjection(actor)} ${pilotJoins}
      WHERE p.id = ${input.id} AND p.workspace_id = ${actor.workspaceId}
      AND (p.creator_user_id = ${actor.userId} OR p.recipient_user_id = ${actor.userId}) FOR UPDATE OF p`);
    if (!row) throw new WorkspaceAccessDenied();
    const pilot = creatorPilotSchema.parse(row);
    if (input.action !== "withdraw" && pilot.isCreator)
      throw new WorkspaceAccessDenied();
    const status =
      input.action === "accept"
        ? "active"
        : input.action === "decline"
          ? "declined"
          : "withdrawn";
    if (pilot.status === status) return pilot;
    if (
      pilot.status !== "pending" &&
      !(pilot.status === "active" && input.action === "withdraw")
    )
      throw new Error(
        "This pilot is already closed. A new invitation is required to start again."
      );
    await query(
      sql`UPDATE creator_pilots SET status = ${status} WHERE id = ${input.id}`
    );
    return creatorPilotSchema.parse({ ...pilot, status });
  });
}

/** Submitted feedback is a separate shared document, never a private run/review export. */
export function readCreatorPilotFeedback(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  return transaction(async () => {
    await requireCreator(actor);
    const [row] = await query(sql`SELECT ${pilotProjection(actor)},
      CASE WHEN p.feedback IS NULL THEN NULL ELSE jsonb_build_object(
        'revision', p.feedback_revision, 'content', p.feedback,
        'updatedAt', extract(epoch FROM p.feedback_updated_at)::float8 * 1000) END AS feedback
      ${pilotJoins} WHERE p.id = ${id} AND p.workspace_id = ${actor.workspaceId}
      AND (p.creator_user_id = ${actor.userId} OR p.recipient_user_id = ${actor.userId})
      FOR SHARE OF p, creator_org, recipient_org`);
    if (!row) throw new WorkspaceAccessDenied();
    return creatorPilotFeedbackViewSchema.parse(row);
  });
}

export function saveCreatorPilotFeedback(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorPilotFeedbackSaveSchema>
) {
  const input = creatorPilotFeedbackSaveSchema.parse(raw);
  return transaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["creator-pilot-feedback", input.id])}, 0))`
    );
    await requireActiveCreatorPilot(actor, input.id);
    const current = await readCreatorPilotFeedback(actor, input.id);
    if (current.feedback?.content !== input.content) {
      if ((current.feedback?.revision ?? null) !== input.expectedRevision)
        throw new Error(
          "This shared feedback changed elsewhere. Reopen it before sending your changes."
        );
      await query(sql`UPDATE creator_pilots SET feedback = ${input.content},
        feedback_revision = ${randomUUID()}, feedback_updated_at = clock_timestamp()
        WHERE id = ${input.id}`);
    }
    return readCreatorPilotFeedback(actor, input.id);
  });
}

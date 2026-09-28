import { sql } from "drizzle-orm";

export const creatorPreviewProjection = sql`id, draft_id AS "draftId", pilot_id AS "pilotId", revision, kind, question, snapshot->>'title' AS title,
  CASE WHEN status IN ('pending', 'running') AND expires_at <= now() THEN 'expired' ELSE status END AS status,
  response, evaluation, models, extract(epoch FROM started_at)::float8 * 1000 AS "startedAt",
  extract(epoch FROM finished_at)::float8 * 1000 AS "finishedAt",
  extract(epoch FROM created_at)::float8 * 1000 AS "createdAt", extract(epoch FROM expires_at)::float8 * 1000 AS "expiresAt",
  CASE WHEN review IS NULL THEN NULL ELSE jsonb_build_object('revision', review_revision, 'content', review,
    'updatedAt', extract(epoch FROM reviewed_at)::float8 * 1000) END AS review`;

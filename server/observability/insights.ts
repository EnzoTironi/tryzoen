import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../operations/async";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { env } from "@shared/environment";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
  WorkspaceAccessDenied,
} from "../workspaces/access";
import {
  openDiagnosticPayload,
  readTelemetryPolicy,
  recordTelemetry,
} from "./events";

const EventRow = z.object({
  id: z.string(),
  kind: z.string(),
  user_id: z.nullable(z.string()),
  workspace_id: z.nullable(z.string()),
  session_id: z.nullable(z.string()),
  turn_id: z.nullable(z.string()),
  status: z.nullable(z.string()),
  name: z.nullable(z.string()),
  model: z.nullable(z.string()),
  created_at: z.coerce.date(),
  metadata: z.json(),
  payload: z.nullable(z.string()),
});

const isTelemetryOperator = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  if (!actor.authSessionId || env.ZOEN_OPERATOR_EMAILS.length === 0)
    return false;

  const rows = await query(
    sql`SELECT email FROM public."user" WHERE ('better-auth:' || id) = ${actor.userId} AND "emailVerified" = true`
  );
  const users = await z.array(z.object({ email: z.string() })).parseAsync(rows);
  return Boolean(
    users[0] && env.ZOEN_OPERATOR_EMAILS.includes(users[0].email.toLowerCase())
  );
};

export const readInsights = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  platform = false
) {
  return await withDatabaseTransaction(async () => {
    const access = await requireWorkspaceAccess(actor);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    const operator = await isTelemetryOperator(actor);
    if (platform && !operator) throw new WorkspaceAccessDenied();
    const visible = platform
      ? sql`TRUE`
      : sql`workspace_id = ${actor.workspaceId} AND (${access.role !== "member"} OR user_id = ${actor.userId})`;
    const totals =
      await query(sql`SELECT count(*) FILTER (WHERE kind = 'turn.completed')::int AS turns,
      count(*) FILTER (WHERE kind = 'turn.failed')::int AS failures,
      count(*) FILTER (WHERE kind = 'action.result' AND status = 'failed')::int AS tool_failures,
      count(*) FILTER (WHERE kind = 'client.error')::int AS client_errors,
      count(*) FILTER (WHERE kind = 'server.error')::int AS server_errors,
      coalesce(sum(input_tokens), 0)::float8 AS input_tokens, coalesce(sum(output_tokens), 0)::float8 AS output_tokens,
      sum(cost_usd)::float8 AS cost_usd,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE kind = 'step.completed')::float8 AS p95_ms
      FROM telemetry_events WHERE ${visible} AND created_at > now() - interval '7 days'`);
    const summary = await z
      .array(
        z.object({
          turns: z.number(),
          failures: z.number(),
          tool_failures: z.number(),
          client_errors: z.number(),
          server_errors: z.number(),
          input_tokens: z.number(),
          output_tokens: z.number(),
          cost_usd: z.nullable(z.number()),
          p95_ms: z.nullable(z.number()),
        })
      )
      .parseAsync(totals);
    const activity =
      await query(sql`SELECT e.session_id, min(e.workspace_id) AS workspace_id, min(e.user_id) AS user_id,
      max(e.created_at) AS last_at, count(*)::int AS events, bool_or(e.status = 'failed') AS failed,
      count(*) FILTER (WHERE e.kind = 'feedback')::int AS feedback, max(r.status) AS review_status
      FROM telemetry_events e LEFT JOIN telemetry_reviews r ON r.session_id = e.session_id
      WHERE ${visible} AND e.created_at > now() - interval '7 days' AND e.session_id IS NOT NULL
      GROUP BY e.session_id ORDER BY max(e.created_at) DESC LIMIT 60`);
    const sessions = await z
      .array(
        z.object({
          session_id: z.string(),
          workspace_id: z.nullable(z.string()),
          user_id: z.nullable(z.string()),
          last_at: z.coerce.date(),
          events: z.number(),
          failed: z.nullable(z.boolean()),
          feedback: z.number(),
          review_status: z.nullable(z.string()),
        })
      )
      .parseAsync(activity);
    return {
      summary: summary[0],
      sessions,
      operator,
      mayManage: access.role !== "member",
      policy: await readTelemetryPolicy(actor.workspaceId),
    };
  });
};

export const readDiagnosticSession = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  sessionId: string,
  platform = false,
  cursor: string | null = null
) {
  return await withDatabaseTransaction(async () => {
    const access = await requireWorkspaceAccess(actor);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    if (platform && !(await isTelemetryOperator(actor)))
      throw new WorkspaceAccessDenied();
    const visible = sql`(${platform} OR (workspace_id = ${actor.workspaceId} AND (${access.role !== "member"} OR user_id = ${actor.userId})))`;
    // Keyset pagination keeps large replays bounded and stable when timestamps are identical.
    const rows = await query(sql`WITH candidates AS (
          SELECT id, kind, user_id, workspace_id, session_id, turn_id, status, name, model, created_at, metadata, payload
          FROM telemetry_events WHERE session_id = ${sessionId} AND ${visible}
            AND (${cursor}::text IS NULL OR (created_at, id) > (
              SELECT created_at, id FROM telemetry_events WHERE id = ${cursor} AND session_id = ${sessionId} AND ${visible}
            )) ORDER BY created_at, id LIMIT 51
        ), bounded AS (
          SELECT *, row_number() OVER (ORDER BY created_at, id) AS position,
            sum(coalesce(octet_length(payload), 0) + octet_length(metadata::text)) OVER (ORDER BY created_at, id) AS bytes,
            lead(id) OVER (ORDER BY created_at, id) IS NOT NULL AS more
          FROM candidates
        ) SELECT * FROM bounded WHERE (bytes <= 2000000 OR position = 1) AND position <= 50 ORDER BY created_at, id`);
    const page = await z
      .array(z.object({ ...EventRow.shape, more: z.boolean() }))
      .parseAsync(rows);
    if (!page.length && !cursor) throw new WorkspaceAccessDenied();
    const policies = new Map<string, boolean>();
    for (const event of page) {
      if (event.workspace_id && !policies.has(event.workspace_id))
        policies.set(
          event.workspace_id,
          (await readTelemetryPolicy(event.workspace_id)).captureContent
        );
    }
    const result = await mapAsync(
      page,
      async ({ more: _more, ...event }) => {
        // A workspace can stop sharing diagnostic content without deleting its operational metrics.
        const allowed = event.workspace_id
          ? (policies.get(event.workspace_id) ?? false)
          : platform && env.ZOEN_BETA_FULL_TELEMETRY;
        const payload =
          allowed && event.payload
            ? await openDiagnosticPayload(event.payload)
            : null;
        return {
          ...event,
          metadata: JSON.stringify(event.metadata),
          payload: payload === null ? null : JSON.stringify(payload),
        };
      },
      5
    );
    if (platform)
      await recordTelemetry({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        kind: "telemetry.operator.read",
        metadata: { sessionId },
      });
    const last = page.at(-1);
    return { events: result, nextCursor: last?.more ? last.id : null };
  });
};

export const reviewDiagnostic = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  sessionId: string,
  status: "new" | "investigating" | "resolved" | "eval-candidate"
) {
  await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor);
    if (!actor.authSessionId || !(await isTelemetryOperator(actor)))
      throw new WorkspaceAccessDenied();
    const rows = await query(
      sql`SELECT id FROM telemetry_events WHERE session_id = ${sessionId} LIMIT 1`
    );
    if (!rows.length) throw new WorkspaceAccessDenied();
    await query(sql`INSERT INTO telemetry_reviews(session_id, status, reviewed_by) VALUES (${sessionId}, ${status}, ${actor.userId})
      ON CONFLICT (session_id) DO UPDATE SET status = EXCLUDED.status, reviewed_by = EXCLUDED.reviewed_by, updated_at = now()`);
    await recordTelemetry({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      kind: "telemetry.operator.review",
      metadata: { sessionId, status },
    });
    return undefined;
  });
};

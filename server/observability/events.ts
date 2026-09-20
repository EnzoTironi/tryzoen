import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getAuth } from "@db/services/auth";
import { env } from "@shared/environment";
import { parseDiagnostic } from "../../shared/observability/redaction";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
  WorkspaceAccessDenied,
} from "../workspaces/access";

const TelemetryEventSchema = z.object({
  id: z.string(),
  kind: z.string(),
  workspaceId: z.optional(z.string()),
  userId: z.optional(z.string()),
  sessionId: z.optional(z.string()),
  turnId: z.optional(z.string()),
  channel: z.optional(z.string()),
  model: z.optional(z.string()),
  name: z.optional(z.string()),
  status: z.optional(z.string()),
  durationMs: z.optional(z.number()),
  inputTokens: z.optional(z.number()),
  outputTokens: z.optional(z.number()),
  costUsd: z.optional(z.number()),
  metadata: z.optional(z.json()),
  payload: z.optional(z.unknown()),
});

export const readTelemetryPolicy = async function (workspaceId: string) {
  const rows = await query(
    sql`SELECT capture_content, retention_days FROM telemetry_settings WHERE workspace_id = ${workspaceId}`
  );
  const policy = await z
    .array(
      z.object({
        capture_content: z.boolean(),
        retention_days: z.number(),
      })
    )
    .parseAsync(rows);
  return {
    captureContent:
      env.ZOEN_BETA_FULL_TELEMETRY && (policy[0]?.capture_content ?? true),
    retentionDays: policy[0]?.retention_days ?? 14,
  };
};

export const recordTelemetry = async function (
  event: z.output<typeof TelemetryEventSchema>
) {
  let payload: string | null = null;
  if (
    event.payload !== undefined &&
    (event.workspaceId
      ? (await readTelemetryPolicy(event.workspaceId)).captureContent
      : env.ZOEN_BETA_FULL_TELEMETRY)
  ) {
    const auth = await getAuth();
    const safe = parseDiagnostic(JSON.stringify(event.payload));
    payload = await (async () =>
      symmetricEncrypt({
        key: (await auth.$context).secretConfig,
        data: JSON.stringify(safe),
      }))();
  }
  await query(sql`INSERT INTO telemetry_events(id, workspace_id, user_id, session_id, turn_id, kind, channel, model, name, status,
    duration_ms, input_tokens, output_tokens, cost_usd, metadata, payload)
    VALUES (${event.id}, ${event.workspaceId ?? null}, ${event.userId ?? null}, ${event.sessionId ?? null}, ${event.turnId ?? null}, ${event.kind},
      ${event.channel ?? null}, ${event.model ?? null}, ${event.name ?? null}, ${event.status ?? null}, ${event.durationMs ?? null},
      ${event.inputTokens ?? null}, ${event.outputTokens ?? null}, ${event.costUsd ?? null}, ${sql`${JSON.stringify(parseDiagnostic(JSON.stringify(event.metadata ?? {})))}::jsonb`}, ${payload})
    ON CONFLICT (id) DO NOTHING`);
};

export const openDiagnosticPayload = async function (payload: string) {
  const auth = await getAuth();
  const text = await (async () =>
    symmetricDecrypt({
      key: (await auth.$context).secretConfig,
      data: payload,
    }))();
  return await jsonString(z.json()).parseAsync(text);
};

export const ClientBatchSchema = z.object({
  recordingId: z.uuid(),
  batchId: z.uuid(),
  kind: z.enum(["replay", "client.error", "client.performance", "feedback"]),
  route: z.string().max(200),
  sessionId: z.optional(z.string().max(100)),
  data: z.string().max(1_000_000),
});

export const ingestClientTelemetry = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  batch: z.output<typeof ClientBatchSchema>
) {
  await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    if (
      !(await readTelemetryPolicy(actor.workspaceId)).captureContent &&
      batch.kind === "replay"
    )
      return undefined;
    // Never accept a client-supplied session belonging to another person or workspace.
    if (batch.sessionId) {
      const sessions = await query(
        sql`SELECT session_id FROM agent_sessions WHERE session_id = ${batch.sessionId} AND workspace_id = ${actor.workspaceId} AND created_by_user_id = ${actor.userId}`
      );
      if (sessions.length !== 1) throw new WorkspaceAccessDenied();
    }
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.userId}, 5814))`
    );
    const recent = await query(
      sql`SELECT id FROM telemetry_events WHERE user_id = ${actor.userId} AND kind IN ('replay', 'client.error', 'client.performance', 'feedback') AND created_at > now() - interval '1 minute' LIMIT 61`
    );
    if (recent.length >= 60) return undefined;
    const content = await jsonString(z.json()).parseAsync(batch.data);
    await recordTelemetry({
      id: `client:${actor.userId}:${batch.batchId}`,
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      sessionId: batch.sessionId ?? `replay:${batch.recordingId}`,
      kind: batch.kind,
      status: batch.kind === "client.error" ? "failed" : "completed",
      name: batch.route.split("?")[0],
      metadata: {
        recordingId: batch.recordingId,
        route: batch.route.split("?")[0] ?? "/",
      },
      payload: content,
    });
    return undefined;
  });
};

export const updateTelemetryPolicy = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  captureContent: boolean,
  retentionDays: 7 | 14 | 30
) {
  await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    await query(sql`INSERT INTO telemetry_settings(workspace_id, capture_content, retention_days) VALUES (${actor.workspaceId}, ${captureContent}, ${retentionDays})
      ON CONFLICT (workspace_id) DO UPDATE SET capture_content = EXCLUDED.capture_content, retention_days = EXCLUDED.retention_days`);
    await recordTelemetry({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      kind: "telemetry.policy.changed",
      metadata: { captureContent, retentionDays },
    });
    return undefined;
  });
};

export const pruneTelemetry = async function () {
  await query(sql`UPDATE telemetry_events e SET payload = NULL WHERE e.payload IS NOT NULL AND e.created_at < now() -
    coalesce((SELECT retention_days FROM telemetry_settings s WHERE s.workspace_id = e.workspace_id), 14) * interval '1 day'`);
  await query(
    sql`DELETE FROM telemetry_events WHERE created_at < now() - interval '90 days'`
  );
  await query(
    sql`DELETE FROM telemetry_reviews r WHERE NOT EXISTS (SELECT 1 FROM telemetry_events e WHERE e.session_id = r.session_id)`
  );
  await query(
    sql`DELETE FROM model_oauth_requests WHERE created_at < now() - interval '1 day'`
  );
};

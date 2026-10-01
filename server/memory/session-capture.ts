import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import { query, transaction } from "@db/queries";
import type { memorySessionSources } from "@db/schema/session-memory";
import { env } from "@shared/environment/env";
import { memoryNamespace, requireMemoryNamespaceAvailable } from "./namespace";
import {
  SessionSourceBackupSchema,
  sessionSourceSchema,
  writeSessionSource,
} from "./session-files";
import { lockSessionSourceAllocation } from "./session-export";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";

export async function captureSessionSource(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof sessionSourceSchema> | null
) {
  if (!env.ZOEN_SESSION_ARCHIVE_DIR || !input) return;
  const source = sessionSourceSchema.parse(input);
  await transaction(async () => {
    const partition = await memoryNamespace(actor);
    if (!partition.automaticEnabled) return;
    const owner = await query(sql`SELECT session_id FROM agent_sessions
      WHERE session_id = ${source.sessionId} AND workspace_id = ${actor.workspaceId}
      AND created_by_user_id = ${actor.userId} FOR SHARE`);
    if (!owner.length) throw new WorkspaceAccessDenied();
    const payload = JSON.stringify(source);
    const digest = createHash("sha256").update(payload).digest("hex");
    const prior = await query<{
      digest: string;
      sessionId: string;
    }>(sql`SELECT digest, session_id AS "sessionId" FROM memory_session_sources
      WHERE namespace_id = ${partition.id} AND event_id = ${source.eventId}`);
    if (prior[0]) {
      if (prior[0].digest !== digest || prior[0].sessionId !== source.sessionId)
        throw new Error("Session source identity conflict.");
      return;
    }
    const [pending] = await query<{ count: string; bytes: string }>(sql`
      SELECT count(*)::text AS count, (COALESCE(sum(octet_length(payload::text)), 0) + octet_length(${payload}::jsonb::text))::text AS bytes
      FROM memory_session_sources WHERE namespace_id = ${partition.id} AND stored_at IS NULL`);
    if (Number(pending?.count) >= 1000 || Number(pending?.bytes) > 8_388_608)
      throw new Error(
        "Session archive is full. Restore archive delivery before continuing."
      );
    // Capture holds the namespace lock. A new event must not bypass a failed
    // earlier event or move a noisy account ahead of accounts already waiting.
    // This producer uses the same short allocation fence as receipt recovery.
    // A restored counter's uncommitted nextval cannot escape its collision scan.
    await lockSessionSourceAllocation();
    const inserted = await query<{
      captureSequence: number;
    }>(sql`INSERT INTO memory_session_sources (namespace_id, event_id, session_id, digest, payload, available_at)
      VALUES (${partition.id}, ${source.eventId}, ${source.sessionId}, ${digest}, ${payload}::jsonb,
        COALESCE((SELECT available_at FROM memory_session_sources
          WHERE namespace_id = ${partition.id} AND stored_at IS NULL
          ORDER BY capture_sequence LIMIT 1), clock_timestamp()))
      RETURNING capture_sequence::float8 AS "captureSequence"`);
    const sequence = SessionSourceBackupSchema.shape.captureSequence.parse(
      inserted[0]?.captureSequence
    );
    if (
      partition.journalHighWater !== null &&
      sequence <= partition.journalHighWater
    )
      throw new Error(
        "Session allocation did not advance the retained journal boundary."
      );
    const recorded = await query(sql`UPDATE workspace_memory_namespace
      SET journal_event_count = journal_event_count + 1, journal_high_water = ${sequence}
      WHERE namespace_id = ${partition.id}
        AND journal_event_count = ${partition.journalEventCount}
        AND journal_high_water IS NOT DISTINCT FROM ${partition.journalHighWater}
      RETURNING namespace_id`);
    if (recorded.length !== 1)
      throw new Error(
        "Session capture could not record its retained journal boundary."
      );
  });
}

/** The outer locks survive a failed batch's savepoint rollback. */
async function deliverNamespace(root: string, visited: readonly string[]) {
  return transaction(
    async () => {
      const [head] = await query<
        Pick<
          typeof memorySessionSources.$inferSelect,
          "namespaceId" | "eventId" | "deliveryFailures"
        >
      >(sql`
      SELECT s.namespace_id AS "namespaceId", s.event_id AS "eventId", s.delivery_failures AS "deliveryFailures"
      FROM memory_session_sources s JOIN workspace_memory_namespace n ON n.namespace_id = s.namespace_id
      JOIN workspace_memberships m ON m.workspace_id = n.workspace_id AND m.user_id = n.user_id
      JOIN workspaces w ON w.id = n.workspace_id
      WHERE s.stored_at IS NULL AND n.enabled AND s.available_at <= statement_timestamp()
        AND NOT EXISTS (SELECT 1 FROM workspace_memory_erasure e WHERE e.namespace_id = n.namespace_id)
        ${
          visited.length
            ? sql`AND s.namespace_id NOT IN (${sql.join(
                visited.map((id) => sql`${id}::uuid`),
                sql`, `
              )})`
            : sql``
        }
        AND (w.organization_id IS NULL OR EXISTS (
          SELECT 1 FROM organization_memberships o
          WHERE o.organization_id = w.organization_id AND o.user_id = n.user_id
          FOR SHARE SKIP LOCKED))
      ORDER BY s.available_at, s.capture_sequence LIMIT 1
      FOR SHARE OF w, m SKIP LOCKED FOR UPDATE OF n, s SKIP LOCKED`);
      if (!head) return null;
      let stored: number;
      try {
        stored = await transaction(() =>
          deliverNamespaceBatch(root, head.namespaceId)
        );
      } catch (error) {
        const delaySeconds = Math.min(
          3600,
          60 * 2 ** Math.min(head.deliveryFailures, 6)
        );
        await query(sql`UPDATE memory_session_sources
        SET available_at = statement_timestamp() + ${delaySeconds} * interval '1 second'
        WHERE namespace_id = ${head.namespaceId} AND stored_at IS NULL`);
        await query(sql`UPDATE memory_session_sources
        SET delivery_failures = delivery_failures + 1, last_failed_at = clock_timestamp()
        WHERE namespace_id = ${head.namespaceId} AND event_id = ${head.eventId}`);
        return {
          namespaceId: head.namespaceId,
          stored: 0,
          failed: true,
          error,
        };
      }
      // At most 1,000 pending records exist per namespace. Moving the remaining
      // batch behind other waiting accounts prevents one account monopolizing
      // every schedule tick, without building a second queue or index service.
      await query(sql`UPDATE memory_session_sources SET available_at = statement_timestamp()
      WHERE namespace_id = ${head.namespaceId} AND stored_at IS NULL`);
      return { namespaceId: head.namespaceId, stored, failed: false };
    },
    { outermost: true }
  );
}

async function deliverNamespaceBatch(root: string, namespaceId: string) {
  const records = await query<
    Pick<
      typeof memorySessionSources.$inferSelect,
      "eventId" | "sessionId" | "captureSequence" | "payload" | "digest"
    >
  >(sql`SELECT event_id AS "eventId", session_id AS "sessionId", capture_sequence::float8 AS "captureSequence", payload, digest
    FROM memory_session_sources WHERE namespace_id = ${namespaceId} AND stored_at IS NULL
    ORDER BY capture_sequence LIMIT 25 FOR UPDATE`);
  // Admission owns the namespace lock. Recheck after any batch-row wait, before
  // publishing files; candidate selection is not consent.
  await requireMemoryNamespaceAvailable(namespaceId);
  for (const record of records) {
    const source = sessionSourceSchema.parse(record.payload);
    if (
      source.sessionId !== record.sessionId ||
      createHash("sha256").update(JSON.stringify(source)).digest("hex") !==
        record.digest
    )
      throw new Error("Session source failed integrity verification.");
    await writeSessionSource(root, namespaceId, source, record.captureSequence);
    await query(sql`UPDATE memory_session_sources SET payload = NULL, stored_at = now()
          WHERE namespace_id = ${namespaceId} AND event_id = ${record.eventId}`);
  }
  return records.length;
}

/** Failed accounts back off independently; successful accounts remain committed. */
export async function drainSessionSources() {
  const root = env.ZOEN_SESSION_ARCHIVE_DIR;
  if (!root) return { stored: 0, configured: false };
  const visited: string[] = [];
  const failures: unknown[] = [];
  let stored = 0;
  for (let count = 0; count < 5; count++) {
    const result = await deliverNamespace(root, visited);
    if (!result) break;
    visited.push(result.namespaceId);
    stored += result.stored;
    if (result.failed) failures.push(result.error);
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      `Session archive delivery failed for ${failures.length} account(s); ${stored} source(s) stored.`
    );
  return { stored, configured: true };
}

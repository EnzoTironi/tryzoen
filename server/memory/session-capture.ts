import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { HookEvent } from "eve/hooks";
import { query, transaction } from "@db/queries";
import { env } from "@shared/environment/env";
import { memoryNamespace } from "./learned";
import {
  sessionSource,
  sessionSourceSchema,
  writeSessionSource,
} from "./session-files";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";

export async function captureSessionSource(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string,
  event: HookEvent
) {
  if (!env.ZOEN_SESSION_ARCHIVE_DIR) return;
  const source = sessionSource(event, sessionId);
  if (!source) return;
  await transaction(async () => {
    const partition = await memoryNamespace(actor);
    if (!partition.enabled) return;
    const owner = await query(sql`SELECT session_id FROM agent_sessions
      WHERE session_id = ${sessionId} AND workspace_id = ${actor.workspaceId}
      AND created_by_user_id = ${actor.userId} FOR SHARE`);
    if (!owner.length) throw new WorkspaceAccessDenied();
    const digest = createHash("sha256")
      .update(JSON.stringify(source))
      .digest("hex");
    const prior = await query<{
      digest: string;
    }>(sql`SELECT digest FROM memory_session_sources
      WHERE namespace_id = ${partition.id} AND event_id = ${source.eventId}`);
    if (prior[0]) {
      if (prior[0].digest !== digest)
        throw new Error("Session source identity conflict.");
      return;
    }
    const pending = await query(sql`SELECT event_id FROM memory_session_sources
      WHERE namespace_id = ${partition.id} AND stored_at IS NULL LIMIT 1000`);
    if (pending.length === 1000)
      throw new Error(
        "Session archive is full. Restore archive delivery before continuing."
      );
    await query(sql`INSERT INTO memory_session_sources (namespace_id, event_id, digest, payload)
      VALUES (${partition.id}, ${source.eventId}, ${digest}, ${JSON.stringify(source)}::jsonb)`);
  });
}

/** Filesystem failure retains the outbox. Replay verifies the immutable file. */
export async function drainSessionSources() {
  const root = env.ZOEN_SESSION_ARCHIVE_DIR;
  if (!root) return { stored: 0, configured: false };
  return transaction(async () => {
    const batch = await query<{
      namespaceId: string;
      eventId: string;
      captureSequence: string;
      payload: unknown;
    }>(sql`
      SELECT s.namespace_id AS "namespaceId", s.event_id AS "eventId", s.capture_sequence::text AS "captureSequence", s.payload
      FROM memory_session_sources s JOIN workspace_memory_namespace n ON n.namespace_id = s.namespace_id
      JOIN workspace_memberships m ON m.workspace_id = n.workspace_id AND m.user_id = n.user_id
      WHERE s.stored_at IS NULL ORDER BY s.capture_sequence LIMIT 25
      FOR SHARE OF n, m SKIP LOCKED FOR UPDATE OF s SKIP LOCKED`);
    for (const record of batch) {
      await writeSessionSource(
        root,
        record.namespaceId,
        sessionSourceSchema.parse(record.payload),
        Number(record.captureSequence)
      );
      await query(sql`UPDATE memory_session_sources SET payload = NULL, stored_at = now()
        WHERE namespace_id = ${record.namespaceId} AND event_id = ${record.eventId}`);
    }
    return { stored: batch.length, configured: true };
  });
}

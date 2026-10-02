import { query as dbQuery } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { readWorkspaceCapabilities } from "../workspaces/capabilities";

const namespaceSchema = z.object({
  id: z.uuid(),
  enabled: z.boolean(),
  preferenceRevision: z.uuid(),
  journalEventCount: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  journalHighWater: z.int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  scopeKey: z.nullable(z.string()),
});
export class MemoryNamespaceError extends Error {
  readonly _tag = "MemoryNamespaceError";
  constructor(readonly reason: "invalid_input" | "erased") {
    super("MemoryNamespaceError");
    this.name = "MemoryNamespaceError";
  }
}

/** Call under this namespace's existing row lock before any content or mutation.
 * A presence read must not wait on a worker's receipt lock and then treat its
 * later deletion as permission to access a restored generation.
 */
export async function requireMemoryNamespaceAvailable(namespaceId: string) {
  const erasure =
    await dbQuery(sql`SELECT namespace_id FROM workspace_memory_erasure
    WHERE namespace_id = ${namespaceId}`);
  if (erasure.length) throw new MemoryNamespaceError("erased");
}

export const memoryNamespace = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  scopeKey?: string
) {
  await requireWorkspaceAccess(actor);
  const [created] =
    await dbQuery(sql`INSERT INTO workspace_memory_namespace (workspace_id, user_id)
    VALUES (${actor.workspaceId}, ${actor.userId}) ON CONFLICT DO NOTHING RETURNING namespace_id AS id`);
  if (created)
    await dbQuery(
      sql`INSERT INTO private_memory_repository(namespace_id) VALUES (${z.uuid().parse(created.id)})`
    );
  const rows =
    await dbQuery(sql`SELECT namespace_id AS id, enabled, preference_revision AS "preferenceRevision", eve_scope_key AS "scopeKey",
      journal_event_count::float8 AS "journalEventCount", journal_high_water::float8 AS "journalHighWater"
      FROM workspace_memory_namespace
      WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId} FOR UPDATE`);
  const partition = await namespaceSchema.parseAsync(rows[0]);
  await requireMemoryNamespaceAvailable(partition.id);
  if (scopeKey !== undefined) {
    if (
      !scopeKey ||
      scopeKey.length > 1024 ||
      (partition.scopeKey !== null && partition.scopeKey !== scopeKey)
    )
      throw new MemoryNamespaceError("invalid_input");
    if (partition.scopeKey === null)
      await dbQuery(
        sql`UPDATE workspace_memory_namespace SET eve_scope_key = ${scopeKey} WHERE namespace_id = ${partition.id}`
      );
  }
  const capabilities = await readWorkspaceCapabilities(actor);
  return {
    ...partition,
    workspaceEnabled: capabilities.enabled.includes("memory"),
    automaticEnabled:
      partition.enabled && capabilities.enabled.includes("memory"),
  };
};

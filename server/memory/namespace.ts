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
  scopeKey: z.nullable(z.string()),
  pendingOperation: z.nullable(z.string()),
  pendingHash: z.nullable(z.string()),
});
export class LearnedMemoryError extends Error {
  readonly _tag = "LearnedMemoryError";
  declare readonly reason:
    | "disabled"
    | "invalid_input"
    | "unavailable"
    | "stale_recall";
  constructor(input: {
    readonly reason:
      | "disabled"
      | "invalid_input"
      | "unavailable"
      | "stale_recall";
  }) {
    super("LearnedMemoryError");
    this.name = "LearnedMemoryError";
    Object.assign(this, input);
  }
}

/** Call under this namespace's existing row lock before any content or mutation.
 * A presence read must not wait on a worker's receipt lock and then treat its
 * later deletion as permission to access a restored generation.
 */
export async function requireMemoryNamespaceAvailable(namespaceId: string) {
  const erasure = await dbQuery(sql`SELECT namespace_id FROM workspace_memory_erasure
    WHERE namespace_id = ${namespaceId}`);
  if (erasure.length)
    throw new LearnedMemoryError({ reason: "stale_recall" });
}

export const memoryNamespace = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  scopeKey?: string
) {
  await requireWorkspaceAccess(actor);
  await dbQuery(
    sql`INSERT INTO workspace_memory_namespace (workspace_id, user_id) VALUES (${actor.workspaceId}, ${actor.userId}) ON CONFLICT DO NOTHING`
  );
  const rows =
    await dbQuery(sql`SELECT namespace_id AS id, enabled, eve_scope_key AS "scopeKey",
      pending_operation AS "pendingOperation", pending_hash AS "pendingHash" FROM workspace_memory_namespace
      WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId} FOR UPDATE`);
  const partition = await namespaceSchema.parseAsync(rows[0]);
  await requireMemoryNamespaceAvailable(partition.id);
  if (scopeKey !== undefined) {
    if (
      !scopeKey ||
      scopeKey.length > 1024 ||
      (partition.scopeKey !== null && partition.scopeKey !== scopeKey)
    )
      throw new LearnedMemoryError({ reason: "invalid_input" });
    if (partition.scopeKey === null)
      await dbQuery(
        sql`UPDATE workspace_memory_namespace SET eve_scope_key = ${scopeKey} WHERE namespace_id = ${partition.id}`
      );
  }
  const capabilities = await readWorkspaceCapabilities(actor);
  return {
    ...partition,
    workspaceEnabled: capabilities.enabled.includes("memory"),
    enabled: partition.enabled && capabilities.enabled.includes("memory"),
  };
};

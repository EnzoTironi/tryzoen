import {
  query as dbQuery,
  transaction as withDatabaseTransaction,
} from "@db/queries";
import { sql } from "drizzle-orm";
import { ZodError as SchemaError } from "zod";
import { SqlError } from "../../db/queries";
import { z } from "zod";
import { createHash } from "node:crypto";

import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { LearnedMemoryItemSchema, Mem0 } from "./mem0";
import { readWorkspaceCapabilities } from "../workspaces/capabilities";

const namespaceSchema = z.object({
  id: z.uuid(),
  enabled: z.boolean(),
  scopeKey: z.nullable(z.string()),
  pendingOperation: z.nullable(z.string()),
  pendingHash: z.nullable(z.string()),
});
const snapshotSchema = z.object({
  enabled: z.boolean(),
  results: z.array(LearnedMemoryItemSchema),
});
export const LearnedMemoryWriteSchema = z.object({
  action: z.enum(["remember", "update", "delete", "clear"]),
  operationId: z.string().min(1).max(256),
  text: z.optional(z.string().min(1).max(8000)),
  memoryId: z.optional(z.uuid()),
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

const mem0 = Mem0;
const namespace = async function (
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
export const LearnedMemory = {
  recall: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    scopeKey: string,
    operationId: string,
    query: string
  ) {
    try {
      return await withDatabaseTransaction(async () => {
        const partition = await namespace(actor, scopeKey);
        if (partition.enabled && partition.pendingOperation !== null)
          throw new LearnedMemoryError({ reason: "stale_recall" });
        const previous = await dbQuery<{
          snapshot: unknown;
        }>(sql`SELECT snapshot FROM workspace_memory_recall
          WHERE namespace_id = ${partition.id} AND operation_id = ${operationId}`);
        if (previous[0]) {
          if (previous[0].snapshot === null)
            throw new LearnedMemoryError({ reason: "stale_recall" });
          return await snapshotSchema.parseAsync(previous[0].snapshot);
        }
        const result = partition.enabled
          ? await mem0.read(partition.id, query.slice(0, 8000) || undefined)
          : { results: [] };
        const value = { enabled: partition.enabled, results: result.results };
        await dbQuery(sql`INSERT INTO workspace_memory_recall (namespace_id, operation_id, snapshot)
          VALUES (${partition.id}, ${operationId}, ${sql`${JSON.stringify(value)}::jsonb`})`);
        // Keep only receipts for older operations; replay must never silently fetch newer facts.
        await dbQuery(sql`UPDATE workspace_memory_recall SET snapshot = NULL
          WHERE namespace_id = ${partition.id} AND created_at < now() - interval '7 days' AND snapshot IS NOT NULL`);
        return value;
      });
    } catch (error) {
      if (error instanceof SqlError || error instanceof SchemaError) {
        throw new LearnedMemoryError({ reason: "unavailable" });
      }
      throw error;
    }
  },
  read: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    query?: string,
    includePaused = false
  ) {
    try {
      return await withDatabaseTransaction(async () => {
        const partition = await namespace(actor);
        if (!partition.enabled && !includePaused)
          return {
            enabled: false,
            workspaceEnabled: partition.workspaceEnabled,
            results: [],
            needsAttention: partition.pendingOperation !== null,
          };
        const result = await mem0.read(partition.id, query?.slice(0, 8000));
        return {
          enabled: partition.enabled,
          workspaceEnabled: partition.workspaceEnabled,
          results: result.results,
          needsAttention: partition.pendingOperation !== null,
        };
      });
    } catch (error) {
      if (error instanceof SqlError || error instanceof SchemaError) {
        throw new LearnedMemoryError({ reason: "unavailable" });
      }
      throw error;
    }
  },
  write: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    raw: z.output<typeof LearnedMemoryWriteSchema>,
    inferInput?: boolean
  ) {
    try {
      const infer = inferInput ?? true;
      const input = await Promise.try(async () =>
        LearnedMemoryWriteSchema.parseAsync(raw)
      ).catch(() => {
        throw new LearnedMemoryError({ reason: "invalid_input" });
      });
      if (
        (input.action === "remember" || input.action === "update") &&
        !input.text
      )
        throw new LearnedMemoryError({ reason: "invalid_input" });
      if (
        (input.action === "update" || input.action === "delete") &&
        !input.memoryId
      )
        throw new LearnedMemoryError({ reason: "invalid_input" });
      const hash = createHash("sha256")
        .update(JSON.stringify({ input, infer }))
        .digest("hex");
      // Fence recall durably BEFORE crossing the service boundary. A timeout or
      // database rollback after Mem0 accepts a deletion cannot expose old notes.
      await withDatabaseTransaction(async () => {
        const partition = await namespace(actor);
        if (!partition.enabled && input.action === "remember")
          throw new LearnedMemoryError({ reason: "disabled" });
        if (
          partition.pendingOperation !== null &&
          input.action !== "clear" &&
          (partition.pendingOperation !== input.operationId ||
            partition.pendingHash !== hash)
        )
          throw new LearnedMemoryError({ reason: "stale_recall" });
        await dbQuery(
          sql`UPDATE workspace_memory_namespace SET pending_operation = ${input.operationId}, pending_hash = ${hash} WHERE namespace_id = ${partition.id}`
        );
        await dbQuery(
          sql`UPDATE workspace_memory_recall SET snapshot = NULL WHERE namespace_id = ${partition.id}`
        );
        return undefined;
      });
      return await withDatabaseTransaction(async () => {
        const partition = await namespace(actor);
        if (
          partition.pendingOperation !== input.operationId ||
          partition.pendingHash !== hash
        )
          throw new LearnedMemoryError({ reason: "stale_recall" });
        const result = await mem0.mutate({
          namespace: partition.id,
          action: input.action,
          operation_id: input.operationId,
          text: input.text,
          memory_id: input.memoryId,
          infer,
        });
        await dbQuery(
          sql`UPDATE workspace_memory_recall SET snapshot = NULL WHERE namespace_id = ${partition.id}`
        );
        await dbQuery(
          sql`UPDATE workspace_memory_namespace SET pending_operation = NULL, pending_hash = NULL WHERE namespace_id = ${partition.id}`
        );
        return result;
      });
    } catch (error) {
      if (error instanceof SqlError || error instanceof SchemaError) {
        throw new LearnedMemoryError({ reason: "unavailable" });
      }
      throw error;
    }
  },
  recover: async function (actor: z.output<typeof WorkspaceActorSchema>) {
    return await withDatabaseTransaction(async () => {
      const partition = await namespace(actor);
      // A fresh, successful service read completes before recall is unfenced.
      // Old operation receipts remain tombstoned; recovery never replays writes.
      await mem0.read(partition.id);
      await dbQuery(
        sql`UPDATE workspace_memory_recall SET snapshot = NULL WHERE namespace_id = ${partition.id}`
      );
      await dbQuery(
        sql`UPDATE workspace_memory_namespace SET pending_operation = NULL, pending_hash = NULL WHERE namespace_id = ${partition.id}`
      );
      return { recovered: true };
    });
  },
  setEnabled: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    enabled: boolean
  ) {
    try {
      return await withDatabaseTransaction(async () => {
        const partition = await namespace(actor);
        await dbQuery(sql`UPDATE workspace_memory_namespace SET enabled = ${enabled}
          WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
        await dbQuery(
          sql`UPDATE workspace_memory_recall SET snapshot = NULL WHERE namespace_id = ${partition.id}`
        );
        return { enabled };
      });
    } catch (error) {
      if (error instanceof SqlError || error instanceof SchemaError) {
        throw new LearnedMemoryError({ reason: "unavailable" });
      }
      throw error;
    }
  },
};

import { memoryNamespace, LearnedMemoryError } from "./namespace";
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
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  LearnedMemoryItemSchema,
  learnedMemoryHistoryInputSchema,
} from "@zoen/companion-ui/memory";
import { FileMemory } from "./ai-memory/learned";
import { FileMemoryError } from "./ai-memory/mutations";
import { LearnedMemoryWriteSchema } from "@zoen/companion-ui/memory";
export { LearnedMemoryWriteSchema } from "@zoen/companion-ui/memory";
import { memoryCorpusInitialized } from "@db/services/memory-corpora";

const snapshotSchema = z.object({
  enabled: z.boolean(),
  results: z.array(LearnedMemoryItemSchema),
});

export const LearnedMemory = {
  backup: async function (actor: z.output<typeof WorkspaceActorSchema>) {
    // Full history is a human export, never a delegated agent's memory read.
    if (
      !actor.authSessionId ||
      actor.agentGrantId ||
      actor.channelIdentityId ||
      actor.protocolTaskId ||
      actor.scheduledRunId ||
      actor.groupBindingId ||
      actor.matrixIdentityId
    )
      throw new WorkspaceAccessDenied();
    return withDatabaseTransaction(async () => {
      const partition = await memoryNamespace(actor);
      if (partition.pendingOperation !== null)
        throw new LearnedMemoryError({ reason: "stale_recall" });
      if (!(await memoryCorpusInitialized(partition.id, "learned-memory")))
        throw new FileMemoryError("not_found");
      const archive = await FileMemory.backup(partition.id);
      await requireWorkspaceAccess(actor);
      return archive;
    });
  },
  history: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    raw: z.infer<typeof learnedMemoryHistoryInputSchema>
  ) {
    const input = learnedMemoryHistoryInputSchema.parse(raw);
    return withDatabaseTransaction(async () => {
      const partition = await memoryNamespace(actor);
      if (!partition.enabled)
        throw new LearnedMemoryError({ reason: "disabled" });
      if (partition.pendingOperation !== null)
        throw new LearnedMemoryError({ reason: "stale_recall" });
      return FileMemory.history(partition.id, input);
    });
  },
  recall: async function (
    actor: z.output<typeof WorkspaceActorSchema>,
    scopeKey: string,
    operationId: string,
    query: string
  ) {
    try {
      return await withDatabaseTransaction(async () => {
        const partition = await memoryNamespace(actor, scopeKey);
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
          ? await FileMemory.read(
              partition.id,
              query.slice(0, 8000) || undefined
            )
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
        const partition = await memoryNamespace(actor);
        if (!partition.enabled && !includePaused)
          return {
            enabled: false,
            workspaceEnabled: partition.workspaceEnabled,
            results: [],
            needsAttention: partition.pendingOperation !== null,
          };
        const result = await FileMemory.read(
          partition.id,
          query?.slice(0, 8000)
        );
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
    raw: z.output<typeof LearnedMemoryWriteSchema>
  ) {
    try {
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
        .update(JSON.stringify(input))
        .digest("hex");
      // Fence recall durably BEFORE crossing the service boundary. A timeout or
      // database rollback after the file engine accepts a deletion cannot expose old notes.
      await withDatabaseTransaction(async () => {
        const partition = await memoryNamespace(actor);
        if (!partition.enabled && input.action === "remember")
          throw new LearnedMemoryError({ reason: "disabled" });
        if (
          partition.pendingOperation !== null &&
          input.action !== "clear" &&
          (partition.pendingOperation !== input.operationId ||
            partition.pendingHash !== hash)
        )
          throw new LearnedMemoryError({ reason: "stale_recall" });
        // Accept the initial corpus in this durable fence transaction, before
        // any mutation can leave uncertain filesystem effects in the next one.
        if (!(await memoryCorpusInitialized(partition.id, "learned-memory"))) {
          if (partition.pendingOperation !== null)
            await FileMemory.recover(partition.id);
          else await FileMemory.read(partition.id);
        }
        await dbQuery(
          sql`UPDATE workspace_memory_namespace SET pending_operation = ${input.operationId}, pending_hash = ${hash} WHERE namespace_id = ${partition.id}`
        );
        await dbQuery(
          sql`UPDATE workspace_memory_recall SET snapshot = NULL WHERE namespace_id = ${partition.id}`
        );
        return undefined;
      });
      return await withDatabaseTransaction(async () => {
        const partition = await memoryNamespace(actor);
        if (
          partition.pendingOperation !== input.operationId ||
          partition.pendingHash !== hash
        )
          throw new LearnedMemoryError({ reason: "stale_recall" });
        const result = await FileMemory.mutate(partition.id, input);
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
      const partition = await memoryNamespace(actor);
      // Verify current source files and checkpoint them before recall is unfenced.
      // Old operation receipts remain tombstoned; recovery never replays writes.
      await FileMemory.recover(partition.id);
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
        const partition = await memoryNamespace(actor);
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

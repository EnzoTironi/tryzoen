import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { SqlError } from "../../db/queries";
import { z } from "zod";

import type { MemoryOperationContext } from "eve/memory";
import { readUserProfile } from "@db/services/user-profile";
import type { AccessScope } from "@shared/identity/access-scope";
import { storedNoteSchema, type PersonalMemorySnapshot } from "./model";
import { PersonalMemoryError, requirePersonalMemoryMembership } from "./access";
import { admitPersonalWipeTarget } from "./group-memory-policy";

const bindingSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(512)
    .refine((value) => value === value.trim(), "Expected trimmed text"),
  namespace: z.string().min(1),
  value: z.string().min(1),
});

const bind = async function (
  scope: AccessScope,
  memory: MemoryOperationContext["memory"]
) {
  try {
    await withDatabaseTransaction(async () => {
      await requirePersonalMemoryMembership(scope);
      const binding = await Promise.try(async () =>
        bindingSchema.parseAsync(memory.scope)
      ).catch(() => {
        throw new PersonalMemoryError({ reason: "invalid_binding" });
      });
      if (memory.slot !== "profile" || binding.value !== scope.workspaceId)
        throw new PersonalMemoryError({ reason: "invalid_binding" });
      // Only a trusted Eve callback supplies this opaque key. Never accept it from a route or tool input.
      await query(sql`INSERT INTO personal_memory_binding (key, workspace_id, namespace, slot)
        VALUES (${binding.key}, ${scope.workspaceId}, ${binding.namespace}, ${memory.slot})
        ON CONFLICT DO NOTHING`);
      const matches = await query(sql`SELECT key FROM personal_memory_binding
        WHERE key = ${binding.key} AND workspace_id = ${scope.workspaceId}
        AND namespace = ${binding.namespace} AND slot = ${memory.slot}`);
      if (matches.length !== 1)
        throw new PersonalMemoryError({ reason: "invalid_binding" });
      return undefined;
    });
    return;
  } catch (error) {
    if (error instanceof SqlError) {
      throw new PersonalMemoryError({ reason: "unavailable" });
    }
    throw error;
  }
};
const inspect = async function (scope: AccessScope) {
  try {
    await requirePersonalMemoryMembership(scope);
    const profile = await Promise.try(async () =>
      readUserProfile(() => requirePersonalMemoryMembership(scope))
    ).catch(() => {
      throw new PersonalMemoryError({ reason: "unavailable" });
    });
    const bindings = await query(sql`SELECT key FROM personal_memory_binding
        WHERE workspace_id = ${scope.workspaceId} AND slot = 'profile'`);
    const rows =
      await query(sql`SELECT d.content, d.version, d.updated_at::text AS "updatedAt"
        FROM personal_memory_binding b INNER JOIN memory_document d ON d.key = b.key
        WHERE b.workspace_id = ${scope.workspaceId} AND b.slot = 'profile'
        ORDER BY b.namespace, b.key`);
    const documents = await Promise.try(async () =>
      z.array(storedNoteSchema).parseAsync(rows)
    ).catch(() => {
      throw new PersonalMemoryError({ reason: "unavailable" });
    });
    await requirePersonalMemoryMembership(scope);
    return {
      scope: "stored-personal-memory",
      generatedAt: new Date().toISOString(),
      profile,
      notes: {
        status: bindings.length ? "located" : "unresolved",
        documents,
      },
      coverage: {
        included: ["structured-profile", "bound-profile-notes"],
        excluded: [
          "conversation-history",
          "artifacts",
          "connected-accounts",
          "schedules",
          "unbound-memory-documents",
        ],
      },
    } satisfies PersonalMemorySnapshot;
  } catch (error) {
    if (error instanceof SqlError) {
      throw new PersonalMemoryError({ reason: "unavailable" });
    }
    throw error;
  }
};
const wipe = async function (scope: AccessScope) {
  try {
    return await withDatabaseTransaction(async () => {
      // G02: personal wipe is private-workspace only; never addresses group scope.
      const coverage = await admitPersonalWipeTarget({
        conversationScope: null,
        chatKind: "private",
      });
      await requirePersonalMemoryMembership(scope);
      // Bound profile documents only — unbound keys are intentionally out of coverage.
      await query(sql`DELETE FROM memory_document d
        USING personal_memory_binding b
        WHERE d.key = b.key
          AND b.workspace_id = ${scope.workspaceId}
          AND b.slot = 'profile'`);
      await query(sql`DELETE FROM personal_memory_binding
        WHERE workspace_id = ${scope.workspaceId} AND slot = 'profile'`);
      await query(
        sql`DELETE FROM user_profiles WHERE workspace_id = ${scope.workspaceId}`
      );
      await requirePersonalMemoryMembership(scope);
      return {
        wiped: coverage.wiped,
        neverWiped: coverage.neverWiped,
      };
    });
  } catch (error) {
    if (error instanceof SqlError) {
      throw new PersonalMemoryError({ reason: "unavailable" });
    }
    throw error;
  }
};
export const PersonalMemory = { bind, inspect, wipe };

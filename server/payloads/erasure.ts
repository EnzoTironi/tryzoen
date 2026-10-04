import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, requireDatabaseTransaction, transaction } from "@db/queries";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { operationSignal, withDeadline } from "../operations/async";
import { PayloadErasureScopeSchema, PayloadError } from "./contract";
import { openPayloads } from "./connection";

/** Call under the committed account/namespace deletion's owning transaction.
 * Account-journal replay restarts both roots; namespace retries retain progress. */
export async function queuePayloadErasure(
  raw: z.input<typeof PayloadErasureScopeSchema>
) {
  requireDatabaseTransaction();
  const scope = PayloadErasureScopeSchema.parse(raw);
  const key = scope.kind === "account" ? "account" : scope.namespaceId;
  if (scope.kind === "private-memory") {
    // Permanent coordinates cannot be removed or reassigned. A retry need not
    // reacquire the account-wide admission lock held only when creating them.
    const existing =
      await query(sql`SELECT completed_at IS NOT NULL AS completed FROM payload_erasure
      WHERE owner_user_id=${scope.ownerUserId} AND scope_key=${key}`);
    if (existing.length)
      return z.object({ completed: z.boolean() }).parse(existing[0]).completed;
  }
  const personalWorkspace =
    scope.kind === "account"
      ? accessScopeForUser(scope.ownerUserId).workspaceId
      : null;
  await query(sql`INSERT INTO payload_erasure(owner_user_id,scope_key,personal_workspace_id)
    VALUES (${scope.ownerUserId},${key},${personalWorkspace})
    ON CONFLICT(owner_user_id,scope_key) ${
      scope.kind === "account"
        ? sql`DO UPDATE SET phase='private',continuation_token=NULL,completed_at=NULL,available_at=clock_timestamp()`
        : sql`DO NOTHING`
    }`);
  const rows =
    await query(sql`SELECT completed_at IS NOT NULL AS completed FROM payload_erasure
    WHERE owner_user_id=${scope.ownerUserId} AND scope_key=${key}`);
  return z.object({ completed: z.boolean() }).parse(rows[0]).completed;
}

const receiptSchema = z.object({
  scope: PayloadErasureScopeSchema,
  phase: z.enum(["private", "personal"]),
  token: z.string().min(1).max(8192).nullable(),
});

async function eraseNext() {
  return transaction(
    async () => {
      const [receipt] = z
        .array(receiptSchema)
        .max(1)
        .parse(
          await query(sql`
      SELECT CASE WHEN scope_key='account'
        THEN json_build_object('kind','account','ownerUserId',owner_user_id)
        ELSE json_build_object('kind','private-memory','ownerUserId',owner_user_id,'namespaceId',scope_key)
        END AS scope,phase,continuation_token AS token
      FROM payload_erasure WHERE available_at<=clock_timestamp()
      ORDER BY available_at,owner_user_id,scope_key LIMIT 1 FOR UPDATE SKIP LOCKED`)
        );
      if (!receipt) return null;
      const { scope } = receipt;
      if (scope.kind === "private-memory" && receipt.phase !== "private")
        throw new PayloadError("invalid");
      const key = scope.kind === "account" ? "account" : scope.namespaceId;
      const personalWorkspace = accessScopeForUser(
        scope.ownerUserId
      ).workspaceId;
      const target =
        scope.kind === "account"
          ? sql`p.owner_user_id=${scope.ownerUserId} OR (p.owner_user_id IS NULL AND p.workspace_id=${personalWorkspace})`
          : sql`p.owner_user_id=${scope.ownerUserId} AND p.kind='private-memory-bundle' AND p.owner_generation=${scope.namespaceId}::uuid`;
      // New registrations are natively fenced by this permanent receipt. Wait for
      // every previously committed writer's bounded window before proving absence.
      const window = z.object({ ready: z.boolean() }).parse(
        (
          await query(sql`SELECT coalesce(max(p.write_until)<=clock_timestamp(),true) AS ready
        FROM payload_object p WHERE ${target}`)
        )[0]
      );
      if (!window.ready) {
        await query(sql`UPDATE payload_erasure SET available_at=(SELECT max(p.write_until) FROM payload_object p WHERE ${target})
        WHERE owner_user_id=${scope.ownerUserId} AND scope_key=${key}`);
        return { completed: 0, progressed: 0 };
      }
      try {
        return await transaction(async () => {
          const connection = openPayloads();
          try {
            const page = await connection.payloads.inventoryPage({
              scope: {
                kind:
                  receipt.phase === "private"
                    ? "private-owner"
                    : "personal-workspace",
                ownerUserId: scope.ownerUserId,
              },
              limit: 25,
              continuationToken: receipt.token,
              signal: operationSignal(),
              deadlineMs: Date.now() + 5000,
            });
            for (const object of page.objects) {
              if (
                scope.kind === "private-memory" &&
                (object.kind !== "private-memory-bundle" ||
                  object.ownerGeneration !== scope.namespaceId)
              )
                continue;
              await connection.payloads.removeLocator({
                key: object.key,
                signal: operationSignal(),
                deadlineMs: Date.now() + 5000,
              });
            }
            const nextPhase =
              page.continuationToken === null &&
              scope.kind === "account" &&
              receipt.phase === "private"
                ? "personal"
                : receipt.phase;
            const finished =
              page.continuationToken === null && nextPhase === receipt.phase;
            await query(sql`UPDATE payload_erasure SET phase=${finished ? "private" : nextPhase},
            continuation_token=${page.continuationToken},
            completed_at=${finished ? sql`coalesce(completed_at,clock_timestamp())` : sql`completed_at`},
            available_at=clock_timestamp()+${finished ? "1 day" : "0 seconds"}::interval
            WHERE owner_user_id=${scope.ownerUserId} AND scope_key=${key}`);
            if (finished && scope.kind === "account")
              await query(sql`UPDATE account_deletion_ledger l SET status='erased'
              FROM account_deletion_requests r WHERE l.request_id=r.id AND r.user_id=${scope.ownerUserId}
              AND l.surface='private_files' AND l.status='pending_external'`);
            return { completed: finished ? 1 : 0, progressed: 1 };
          } finally {
            connection.close();
          }
        });
      } catch (error) {
        // Partial provider deletions are safe to repeat. Never advance the cursor
        // or acknowledge absence when any DELETE/GET result is unknown.
        await query(sql`UPDATE payload_erasure SET available_at=clock_timestamp()+interval '2 minutes'
        WHERE owner_user_id=${scope.ownerUserId} AND scope_key=${key}`);
        return { completed: 0, progressed: 0, error };
      }
    },
    { outermost: true }
  );
}

/** One tick scans at most five 25-object pages. Completed coordinates stay and
 * sweep daily, including objects from a delayed PUT or a restored old database. */
export async function drainPayloadErasures() {
  return withDeadline(async () => {
    let completed = 0;
    let progressed = 0;
    const failures: unknown[] = [];
    for (let count = 0; count < 5; count++) {
      const result = await eraseNext();
      if (!result) break;
      completed += result.completed;
      progressed += result.progressed;
      if ("error" in result) failures.push(result.error);
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Private file erasure has pending operations"
      );
    return { completed, progressed };
  }, Date.now() + 30_000);
}

import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, transaction } from "@db/queries";
import { readAdmissionEntitlement } from "@db/services/billing";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import type { toolCallAllocations } from "@db/schema/tool-call-allocations";
import {
  publishedSourceBindingSchema,
  postgresReadArgumentsSchema,
  sourceBindingSchema,
} from "@zoen/companion-ui/workspace-sources";
import {
  GitRevisionSchema,
  sourceBindingPathSchema,
} from "@zoen/companion-ui/workspace-files";
import { WorkspaceRepository } from "../workspaces/repository";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { resolveWorkspaceBillingSubject } from "../workspaces/billing";
import { lockMatrixAdmission } from "../matrix/authority";
import { admitQuota, emptyQuotaUsage } from "./quotas";

const nativeOperationSchema = z.strictObject({
  sessionId: z.string().min(1).max(256),
  callId: z.string().min(1).max(256),
});
const sourceReadRequestSchema = z.strictObject({
  path: sourceBindingPathSchema,
  revision: GitRevisionSchema,
  arguments: postgresReadArgumentsSchema,
});
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const receiptSchema = z.strictObject({
  id: z.uuid(),
  operationHash: hash,
  requestHash: hash,
  actorHash: hash,
  payerHash: hash,
  windowDate: z.iso.date(),
});
const allocationSchema = receiptSchema.extend({
  status: z.enum(["reserved", "uncertain", "settled"]),
  consumedCalls: z.literal([0, 1]).nullable(),
});

class SourceReadBudgetError extends Error {
  readonly name = "SourceReadBudgetError";
  constructor() {
    super("Source read budget is unavailable or its operation changed.");
  }
}

const selectAllocation = (predicate: ReturnType<typeof sql>) =>
  query<
    Pick<
      typeof toolCallAllocations.$inferSelect,
      | "id"
      | "operationHash"
      | "requestHash"
      | "actorHash"
      | "payerHash"
      | "windowDate"
      | "status"
      | "consumedCalls"
    >
  >(sql`SELECT id, operation_hash AS "operationHash", request_hash AS "requestHash",
  actor_hash AS "actorHash", payer_hash AS "payerHash", window_date::text AS "windowDate",
  status, consumed_calls AS "consumedCalls" FROM tool_call_allocations
  WHERE ${predicate} FOR UPDATE`);

const lockAccounting = (actorHash: string) =>
  query(sql`
  SELECT pg_advisory_xact_lock(hashtextextended(${`quota:tool-call:${actorHash}`}, 0))`);

/** Commit one actor tool-call reservation before any warehouse/provider work.
 * Identity comes ONLY from the supported Eve execute context, not model input.
 * A replay disposition is never permission to dispatch again. This enforces
 * actor daily tool calls, not pooled company or physical executor capacity.
 * It is not an executable transport grant: the owning fixed-read builder must
 * validate exact published filter arity/types before decrypt, DNS or socket I/O.
 */
export async function admitSourceReadBudget(
  actor: z.output<typeof WorkspaceActorSchema>,
  native: z.input<typeof nativeOperationSchema>,
  raw: z.input<typeof sourceReadRequestSchema>
) {
  const operation = nativeOperationSchema.parse(native);
  const input = sourceReadRequestSchema.parse(raw);
  return transaction(
    async () => {
      await lockMatrixAdmission([actor.workspaceId], []);
      const payer = await resolveWorkspaceBillingSubject(actor);
      const owned = await query(sql`SELECT session_id FROM agent_sessions
      WHERE session_id = ${operation.sessionId} AND workspace_id = ${actor.workspaceId}
        AND created_by_user_id = ${actor.userId} FOR SHARE`);
      if (owned.length !== 1) throw new WorkspaceAccessDenied();
      const selected = await WorkspaceRepository.selection(actor, [input.path]);
      const document = selected.documents[0];
      if (
        selected.revision !== input.revision ||
        selected.documents.length !== 1 ||
        !document ||
        document.path !== input.path
      )
        throw new WorkspaceAccessDenied();
      const binding = sourceBindingSchema.parse(JSON.parse(document.content));
      // These locked metadata checks never select or decrypt a credential.
      const connections = await query(sql`SELECT id FROM tool_connections
      WHERE id = ${binding.connection.id} AND revision = ${binding.connection.revision}
        AND workspace_id = ${actor.workspaceId} AND kind = 'postgres' AND revoked_at IS NULL
        AND (share = 'workspace' OR connected_by = ${actor.userId}) FOR SHARE`);
      const heads = await query(sql`SELECT head_sha FROM workspace_repository
      WHERE workspace_id = ${actor.workspaceId} AND head_sha = ${input.revision} FOR SHARE`);
      if (connections.length !== 1 || heads.length !== 1)
        throw new WorkspaceAccessDenied();
      const entitlement = await readAdmissionEntitlement(payer);
      const { secretEncryptionKey } = await getInstallationSecrets();
      const identity = (domain: string, value: unknown) =>
        createHmac("sha256", Buffer.from(secretEncryptionKey, "base64"))
          .update(JSON.stringify([`zoen:tool-call-budget:${domain}:v1`, value]))
          .digest("hex");
      const keyFingerprint = identity("ledger-key", "installation");
      await query(sql`INSERT INTO tool_call_accounting(id,key_fingerprint) VALUES (1,${keyFingerprint})
        ON CONFLICT (id) DO NOTHING`);
      const [accounting] = await query<{
        keyFingerprint: string;
      }>(sql`SELECT key_fingerprint AS "keyFingerprint"
        FROM tool_call_accounting WHERE id = 1 FOR SHARE`);
      if (!accounting || accounting.keyFingerprint !== keyFingerprint)
        throw new SourceReadBudgetError();
      const actorHash = identity("actor", actor.userId);
      const payerHash = identity("payer", [payer.subjectType, payer.subjectId]);
      const operationHash = identity("operation", [
        operation.sessionId,
        operation.callId,
      ]);
      const requestHash = identity("source-read", [
        actorHash,
        payerHash,
        actor.workspaceId,
        operation.sessionId,
        operation.callId,
        input.path,
        input.revision,
        document.content,
        Object.keys(input.arguments)
          .toSorted()
          .map((key) => [key, input.arguments[key]]),
      ]);
      await lockAccounting(actorHash);
      const previous = (
        await selectAllocation(sql`operation_hash = ${operationHash}`)
      )[0];
      if (previous) {
        const parsed = allocationSchema.parse(previous);
        if (
          parsed.requestHash !== requestHash ||
          parsed.actorHash !== actorHash ||
          parsed.payerHash !== payerHash
        )
          throw new SourceReadBudgetError();
        const { status, consumedCalls, ...receipt } = parsed;
        return {
          disposition: "replay" as const,
          receipt,
          status,
          consumedCalls,
        };
      }
      const [clock] = await query<{ windowDate: string; createdAt: Date }>(sql`
      SELECT to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD') AS "windowDate", at AS "createdAt"
      FROM (SELECT clock_timestamp() AS at) tick`);
      if (!clock) throw new SourceReadBudgetError();
      const windowDate = z.iso.date().parse(clock.windowDate);
      const [usage] = await query<{ calls: string | number }>(sql`
      SELECT COALESCE(SUM(CASE WHEN status = 'settled' THEN consumed_calls ELSE 1 END),0)::text AS calls
      FROM tool_call_allocations WHERE actor_hash = ${actorHash} AND window_date = ${windowDate}::date`);
      const snapshot = emptyQuotaUsage();
      snapshot.user.dailyToolCalls = z.coerce
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .parse(usage?.calls);
      await admitQuota(snapshot, { toolCalls: 1 }, entitlement.limits);
      const receipt = receiptSchema.parse({
        id: randomUUID(),
        operationHash,
        requestHash,
        actorHash,
        payerHash,
        windowDate,
      });
      const inserted =
        await query(sql`INSERT INTO tool_call_allocations(id, key_fingerprint, operation_hash, request_hash, actor_hash, payer_hash, window_date, status, created_at)
      VALUES (${receipt.id},${keyFingerprint},${operationHash},${requestHash},${actorHash},${payerHash},${windowDate}::date,'reserved',${clock.createdAt})
      ON CONFLICT (operation_hash) DO NOTHING RETURNING id`);
      // A cross-actor claim cannot turn a conflict into another dispatch permit.
      if (inserted.length !== 1) throw new SourceReadBudgetError();
      return {
        disposition: "new" as const,
        receipt,
        published: publishedSourceBindingSchema.parse({
          path: input.path,
          revision: input.revision,
          binding,
        }),
      };
    },
    { outermost: true }
  );
}

/** Record observed consumption even after auth revocation, using this exact
 * internal receipt. Never expose this as a client/model settlement API. Unknown
 * work retains its hold; resolving it requires confirmed native/provider evidence.
 * Repeated identical settlement is inert; a conflicting final claim is rejected.
 */
export async function settleSourceReadBudget(
  raw: z.input<typeof receiptSchema>,
  consumption: 0 | 1 | "unknown"
) {
  const receipt = receiptSchema.parse(raw);
  const observed = z
    .union([z.literal([0, 1]), z.literal("unknown")])
    .parse(consumption);
  return transaction(
    async () => {
      await lockAccounting(receipt.actorHash);
      const row = (await selectAllocation(sql`id = ${receipt.id}`))[0];
      if (!row) throw new SourceReadBudgetError();
      const allocation = allocationSchema.parse(row);
      if (
        Object.entries(receipt).some(
          ([key, value]) => Reflect.get(allocation, key) !== value
        )
      )
        throw new SourceReadBudgetError();
      if (allocation.status === "settled") {
        if (observed === "unknown" || observed === allocation.consumedCalls)
          return;
        throw new SourceReadBudgetError();
      }
      if (observed === "unknown") {
        await query(
          sql`UPDATE tool_call_allocations SET status = 'uncertain' WHERE id = ${receipt.id} AND status = 'reserved'`
        );
        return;
      }
      await query(sql`UPDATE tool_call_allocations SET status = 'settled', consumed_calls = ${observed}, settled_at = clock_timestamp()
      WHERE id = ${receipt.id} AND status IN ('reserved','uncertain')`);
    },
    { outermost: true }
  );
}

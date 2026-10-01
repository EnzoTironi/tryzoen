import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { readBody } from "../http/body";
import { operationSignal, withTimeout } from "../operations/async";
import { lockMatrixAdmission } from "./authority";
import {
  deactivateMatrixUser,
  matrixConfiguration,
  matrixRequest,
} from "./client";
import { MatrixErasureDepartureSchema } from "./erasure";
import { readNativeGroupMembership } from "./membership";

const departureSchema = MatrixErasureDepartureSchema.extend({
  ownerUserId: z.string().min(1),
});
const ledgerCandidateSchema = z.strictObject({
  ledgerId: z.uuid(),
  userId: z.string().min(1),
  matrixId: MatrixErasureDepartureSchema.shape.matrixId,
});

function withinBudget<Value>(deadlineMs: number, run: () => Promise<Value>) {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0)
    throw new Error("Matrix erasure reconciliation deadline reached.");
  return withTimeout(run, remaining);
}

function boundedTransaction<Value>(
  deadlineMs: number,
  run: () => Promise<Value>
) {
  return withinBudget(deadlineMs, () =>
    transaction(
      async () => {
        await remainingStatementTimeout(deadlineMs);
        return await run();
      },
      { outermost: true }
    )
  );
}

async function remainingStatementTimeout(deadlineMs: number) {
  // HTTP time does not leave a later SQL statement with the tick's original
  // larger timeout. Query also checks the current operation signal.
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0)
    throw new Error("Matrix erasure reconciliation deadline reached.");
  await query(
    sql`SELECT set_config('statement_timeout',${String(remaining)},true)`
  );
}

async function verifyDeactivation(matrixId: string) {
  const config = await matrixConfiguration();
  if (!matrixId.endsWith(`:${config.serverName}`))
    throw new Error("Unconfigured Matrix identity installation.");
  const response = await fetch(
    new URL(
      `/_synapse/admin/v2/users/${encodeURIComponent(matrixId)}`,
      config.url
    ),
    {
      method: "GET",
      redirect: "error",
      signal: operationSignal(),
      headers: { authorization: `Bearer ${config.token.reveal()}` },
    }
  );
  // A generic 404 or POST acknowledgement is not proof of erased state.
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Matrix account erasure is unconfirmed.");
  }
  const bytes = await readBody(response.body, 16384);
  z.object({
    name: z.literal(matrixId),
    deactivated: z.literal(true),
    erased: z.literal(true),
  }).parse(JSON.parse(bytes.toString("utf8")));
}

async function acknowledgeIdentity(
  ledgerId: string,
  matrixId: string,
  deadlineMs: number
) {
  await boundedTransaction(deadlineMs, async () => {
    const rows = await query(sql`SELECT l.matrix_ids,r.user_id AS "userId"
      FROM account_deletion_ledger l JOIN account_deletion_requests r ON r.id=l.request_id
      WHERE l.id=${ledgerId} AND l.surface='matrix' FOR UPDATE OF l`);
    if (!rows.length) return;
    const latest = z
      .object({
        userId: z.string(),
        matrix_ids: z
          .array(MatrixErasureDepartureSchema.shape.matrixId)
          .max(1024),
      })
      .parse(rows[0]);
    if (!latest.matrix_ids.includes(matrixId)) return;
    // Subtract the attempted identity from the latest row, never a pre-I/O array.
    await remainingStatementTimeout(deadlineMs);
    await query(sql`UPDATE account_deletion_ledger l SET
      matrix_ids=array_remove(l.matrix_ids,${matrixId}),
      status=CASE WHEN cardinality(array_remove(l.matrix_ids,${matrixId}))>0
        OR EXISTS(SELECT 1 FROM matrix_erasure_departures d WHERE d.owner_user_id=${latest.userId})
        THEN 'pending_external' ELSE 'erased' END WHERE l.id=${ledgerId} AND l.surface='matrix'`);
  });
}

async function retireDeparture(
  item: z.infer<typeof departureSchema>,
  deadlineMs: number
) {
  await boundedTransaction(deadlineMs, async () => {
    await lockMatrixAdmission([item.workspaceId], [item.bindingId]);
    const config = await matrixConfiguration();
    if (
      item.installationId !== config.serverName ||
      !item.matrixId.endsWith(`:${config.serverName}`)
    )
      throw new Error("Unconfigured Matrix departure installation.");
    await remainingStatementTimeout(deadlineMs);
    const exact =
      await query(sql`SELECT d.matrix_id FROM matrix_erasure_departures d
      JOIN workspace_group_bindings b ON b.id=d.binding_id JOIN workspaces w ON w.id=b.workspace_id
      WHERE d.binding_id=${item.bindingId} AND d.matrix_id=${item.matrixId} AND d.owner_user_id=${item.ownerUserId}
        AND d.native_retry_at<=now() AND b.channel='matrix' AND b.conversation_id=${item.roomId}
        AND b.installation_id=${item.installationId} AND b.workspace_id=${item.workspaceId}
        AND w.organization_id IS NOT DISTINCT FROM ${item.organizationId} FOR UPDATE OF b,d`);
    if (!exact.length) return;
    const before = await readNativeGroupMembership(item.roomId, item.matrixId);
    if (before === "join" || before === "invite" || before === "knock")
      await matrixRequest(
        "POST",
        `rooms/${encodeURIComponent(item.roomId)}/kick`,
        {
          user_id: item.matrixId,
          reason: "Account deleted",
        }
      );
    const after = await readNativeGroupMembership(item.roomId, item.matrixId);
    if (after !== "leave" && after !== "ban")
      throw new Error("Matrix room departure is unconfirmed.");
    await remainingStatementTimeout(deadlineMs);
    await query(sql`DELETE FROM matrix_erasure_departures
      WHERE binding_id=${item.bindingId} AND matrix_id=${item.matrixId} AND owner_user_id=${item.ownerUserId}`);
    await remainingStatementTimeout(deadlineMs);
    await query(sql`UPDATE account_deletion_ledger l SET status='erased'
      FROM account_deletion_requests r WHERE r.id=l.request_id AND r.user_id=${item.ownerUserId}
        AND l.surface='matrix' AND cardinality(l.matrix_ids)=0
        AND NOT EXISTS(SELECT 1 FROM matrix_erasure_departures d WHERE d.owner_user_id=${item.ownerUserId})`);
  });
}

/** Drain only previously committed native obligations. The existing schedule
 * owns invocation; no account request/replay performs Matrix provider I/O.
 * Provider ACK is insufficient: exact account state and room absence are separate.
 */
export async function reconcileMatrixErasures(
  deadlineMs: number,
  limit: number
) {
  z.number().int().min(0).max(50).parse(limit);
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(deadlineMs);
  if (limit === 0 || deadlineMs <= Date.now()) return 0;
  if (deadlineMs > Date.now() + 30_000)
    throw new Error("Matrix erasure deadline exceeds bounded schedule budget.");
  // This initial guard rejects nested/savepoint callers before any provider I/O.
  const { departures, config: installation } = await boundedTransaction(
    deadlineMs,
    async () => {
      const config = await matrixConfiguration();
      const suffix = `:${config.serverName}`;
      const rows =
        await query(sql`SELECT d.binding_id AS "bindingId",d.matrix_id AS "matrixId",d.owner_user_id AS "ownerUserId",
      b.conversation_id AS "roomId",b.installation_id AS "installationId",b.workspace_id AS "workspaceId",w.organization_id AS "organizationId"
      FROM matrix_erasure_departures d JOIN workspace_group_bindings b ON b.id=d.binding_id JOIN workspaces w ON w.id=b.workspace_id
      WHERE d.native_retry_at<=now() AND b.channel='matrix'
        AND b.installation_id=${config.serverName} AND right(d.matrix_id,char_length(${suffix}))=${suffix}
      ORDER BY d.native_retry_at,d.binding_id,d.matrix_id LIMIT ${Math.ceil(limit / 2)}`);
      return {
        config,
        departures: z
          .array(departureSchema)
          .max(Math.ceil(limit / 2))
          .parse(rows),
      };
    }
  );
  let consumed = 0;
  for (const item of departures) {
    if (Date.now() >= deadlineMs) return consumed;
    consumed += 1;
    try {
      await retireDeparture(item, deadlineMs);
    } catch {
      if (Date.now() < deadlineMs)
        await boundedTransaction(deadlineMs, () =>
          query(sql`UPDATE matrix_erasure_departures
          SET native_retry_at=now()+interval '1 minute'
          WHERE binding_id=${item.bindingId} AND matrix_id=${item.matrixId} AND owner_user_id=${item.ownerUserId}`)
        );
      console.warn("Matrix erasure departure remains pending");
    }
  }
  if (Date.now() >= deadlineMs || consumed === limit) return consumed;
  const identities = await boundedTransaction(deadlineMs, async () => {
    const rows =
      await query(sql`SELECT l.id AS "ledgerId",r.user_id AS "userId",ids.matrix_id AS "matrixId"
      FROM account_deletion_ledger l JOIN account_deletion_requests r ON r.id=l.request_id
      CROSS JOIN LATERAL unnest(l.matrix_ids) WITH ORDINALITY AS ids(matrix_id,position)
      WHERE l.surface='matrix' AND l.status='pending_external'
        AND right(ids.matrix_id,char_length(${`:${installation.serverName}`}))=${`:${installation.serverName}`}
      ORDER BY r.completed_at,l.id,ids.position LIMIT ${limit - consumed}`);
    return z
      .array(ledgerCandidateSchema)
      .max(limit - consumed)
      .parse(rows);
  });
  for (const item of identities) {
    if (Date.now() >= deadlineMs) break;
    consumed += 1;
    try {
      await withinBudget(deadlineMs, async () => {
        const config = await matrixConfiguration();
        if (!item.matrixId.endsWith(`:${config.serverName}`))
          throw new Error("Unconfigured Matrix identity installation.");
        // No SQL transaction is held during this provider call. A concurrent
        // replay can add B while A completes; acknowledgement reads the latest row.
        await deactivateMatrixUser(item.matrixId);
        await verifyDeactivation(item.matrixId);
      });
      await acknowledgeIdentity(item.ledgerId, item.matrixId, deadlineMs);
    } catch {
      if (Date.now() < deadlineMs)
        await boundedTransaction(deadlineMs, () =>
          query(sql`UPDATE account_deletion_ledger SET
          matrix_ids=array_remove(matrix_ids,${item.matrixId})||ARRAY[${item.matrixId}]::text[]
          WHERE id=${item.ledgerId} AND surface='matrix' AND status='pending_external' AND ${item.matrixId}=ANY(matrix_ids)`)
        );
      console.warn("Matrix account erasure remains pending");
    }
  }
  return consumed;
}

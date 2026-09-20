import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { ChannelTransportError } from "../channels/transport";
import { ScheduleOwnerInactive } from "./channel-owner";
import { z } from "zod";

import { inputRequestSchema } from "eve/client";
import { scheduledRunOutcomeSchema } from "../../shared/schedules/outcome";
import { ChannelTransport } from "../channels/transport";
import { requireScheduledChannelOwner } from "./channel-owner";
import {
  nativeReportReceiptStatus,
  nativeReportOutputSetComplete,
  renderNativeReport,
} from "./native-report-render";

const reportSchema = z.object({
  id: z.string(),
  reportSequence: z.number().int(),
  conversationChannel: z.enum(["telegram", "kapso"]),
  conversationId: z.string(),
  createdByUserId: z.string(),
  workspaceId: z.string(),
  prompt: z.string(),
  outcome: z.unknown(),
  pendingInputRequests: z.unknown(),
  reportStatus: z.string(),
});
class NativeReportInvalid extends Error {
  readonly _tag = "NativeReportInvalid";

  constructor() {
    super("NativeReportInvalid");
    this.name = "NativeReportInvalid";
  }
}

// Existing outcome/input schemas belong to the scheduler/Eve boundary; no second validator.
const renderStoredReport = async function (
  report: z.output<typeof reportSchema>
) {
  if (report.outcome === null && report.pendingInputRequests === null)
    throw new NativeReportInvalid();
  try {
    return renderNativeReport({
      prompt: report.prompt,
      outcome:
        report.outcome === null
          ? null
          : scheduledRunOutcomeSchema.parse(report.outcome),
      pendingInputRequests:
        report.pendingInputRequests === null
          ? null
          : inputRequestSchema
              .array()
              .min(1)
              .parse(report.pendingInputRequests),
    });
  } catch {
    throw new NativeReportInvalid();
  }
};

export const dispatchNativeScheduledReport = async function (runId: string) {
  const transport = ChannelTransport;
  return await withDatabaseTransaction(async () => {
    const rows =
      await query(sql`SELECT r.id, r.report_sequence AS "reportSequence", r.report_status AS "reportStatus",
      r.outcome, r.pending_input_requests AS "pendingInputRequests", j.prompt,
      j.conversation_channel AS "conversationChannel", j.conversation_id AS "conversationId",
      j.created_by_user_id AS "createdByUserId", j.workspace_id AS "workspaceId"
      FROM scheduled_agent_runs r JOIN scheduled_agent_jobs j ON j.id = r.job_id
      WHERE r.id = ${runId} AND j.conversation_channel IN ('telegram', 'kapso')
      AND r.status IN ('completed', 'dead_letter', 'waiting_for_input') FOR UPDATE OF r`);
    if (!rows[0]) return false;
    const report = await reportSchema.parseAsync(rows[0]);
    if (!["pending", "queued"].includes(report.reportStatus)) return true;
    const deliveryKey = `schedulereport:${runId}:${String(report.reportSequence)}`;
    const prefix = `${deliveryKey}:`;
    const outputs = await query<{
      chunkIndex: number;
      outboxId: string;
    }>(sql`SELECT chunk_index AS "chunkIndex", outbox_id AS "outboxId"
        FROM scheduled_agent_report_outputs
        WHERE run_id = ${runId} AND report_sequence = ${report.reportSequence} ORDER BY chunk_index`);
    const chunks = await query<{
      id: string;
      key: string;
      status: string;
    }>(sql`SELECT id, delivery_key AS key, status
        FROM channel_outbox WHERE identity_id = ${report.conversationId}
        AND left(delivery_key, char_length(${prefix})) = ${prefix}`);
    // Queued is the commit seal: enqueue, the complete bindings and this transition
    // share one transaction. Recovery compares every durable chunk, never a subset.
    if (
      report.reportStatus === "queued" ||
      outputs.length > 0 ||
      chunks.length > 0
    ) {
      const complete =
        report.reportStatus === "queued" &&
        nativeReportOutputSetComplete(outputs, chunks, prefix);
      const status = complete
        ? nativeReportReceiptStatus(chunks.map((chunk) => chunk.status))
        : "uncertain";
      await query(sql`UPDATE scheduled_agent_runs SET report_status = ${status}, updated_at = clock_timestamp()
          WHERE id = ${runId} AND report_sequence = ${report.reportSequence}`);
      return true;
    }
    const active = await Promise.try(async () => {
      try {
        await requireScheduledChannelOwner(report);
        return true;
      } catch (error) {
        if (error instanceof ScheduleOwnerInactive) return false;
        throw error;
      }
    }).catch((error: unknown) => {
      if (error instanceof ChannelTransportError)
        return error.reason === "identity_inactive" ||
          error.reason === "channel_mismatch"
          ? Promise.resolve(false)
          : Promise.reject(error);
      throw error;
    });
    if (!active) {
      await query(sql`UPDATE scheduled_agent_runs SET report_status = 'cancelled',
        report_lease_token = NULL, report_lease_expires_at = NULL, updated_at = clock_timestamp()
        WHERE id = ${runId} AND report_sequence = ${report.reportSequence}`);
      return true;
    }
    const text = await renderStoredReport(report);
    if (!text) {
      await query(sql`UPDATE scheduled_agent_runs SET report_status = 'not_needed', updated_at = clock_timestamp()
        WHERE id = ${runId} AND report_sequence = ${report.reportSequence}`);
      return true;
    }
    const receipts = await transport.enqueueText({
      identityId: report.conversationId,
      deliveryKey,
      text,
    });
    for (const [index, receipt] of receipts.entries()) {
      await query(sql`INSERT INTO scheduled_agent_report_outputs (run_id, report_sequence, chunk_index, outbox_id)
        VALUES (${runId}, ${report.reportSequence}, ${index}, ${receipt.id})`);
    }
    await query(sql`UPDATE scheduled_agent_runs SET report_status = 'queued',
      report_lease_token = NULL, report_lease_expires_at = NULL, updated_at = clock_timestamp()
      WHERE id = ${runId} AND report_sequence = ${report.reportSequence}`);
    return true;
  });
};

/** Enqueue durably, attempt delivery after commit, then reconcile actual receipts. */
export const deliverNativeScheduledReport = async function (runId: string) {
  await dispatchNativeScheduledReport(runId);

  const rows = await query<{ identityId: string }>(sql`
      SELECT j.conversation_id AS "identityId"
      FROM scheduled_agent_runs r JOIN scheduled_agent_jobs j ON j.id = r.job_id
      WHERE r.id = ${runId} AND r.report_status = 'queued'
        AND j.conversation_channel IN ('telegram', 'kapso')`);
  if (!rows[0]) return;
  const transport = ChannelTransport;
  const delivery = await transport.drainOutbox(rows[0].identityId).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  await dispatchNativeScheduledReport(runId);
  if (!delivery.ok) throw delivery.error;
};

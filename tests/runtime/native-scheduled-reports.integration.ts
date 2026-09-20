import { onTestFinished } from "vitest";
import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import {
  claimScheduledReport,
  getScheduledReportChannel,
} from "../../db/services/scheduled-agent-jobs";
import { randomUUID } from "node:crypto";
import type { HookContext } from "eve/hooks";
import completionHook from "../../agent/hooks/scheduled-run-completion";
import { expect, test } from "vitest";
import { ChannelTransport } from "../../server/channels/transport";
import { Messaging } from "../../server/messaging";
import {
  dispatchNativeScheduledReport,
  deliverNativeScheduledReport,
} from "../../server/schedules/native-report";
import { requireScheduledChannelOwner } from "../../server/schedules/channel-owner";
import { accessScopeForUser } from "../../shared/identity/access-scope";
const fixture = async function (
  body: (fixture: {
    runId: string;
    jobId: string;
    identityId: string;
    userId: string;
    workspaceId: string;
  }) => Promise<void>,
  channel: "telegram" | "kapso" = "telegram"
) {
  const userId = randomUUID();
  const scope = accessScopeForUser(`better-auth:${userId}`);
  const identityId = randomUUID(),
    jobId = randomUUID(),
    runId = randomUUID();
  await query(
    sql`INSERT INTO "user" (id, name, email) VALUES (${userId}, 'Schedule proof', ${`${userId}@example.invalid`})`
  );
  onTestFinished(async () => {
    await query(sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`);
    await query(sql`DELETE FROM "user" WHERE id = ${userId}`);
  });
  await query(sql`INSERT INTO workspaces (id) VALUES (${scope.workspaceId})`);
  await query(sql`INSERT INTO workspace_memberships (workspace_id, user_id, role)
    VALUES (${scope.workspaceId}, ${scope.userId}, 'owner')`);
  await query(sql`INSERT INTO channel_identity (id, channel, installation_id, sender_id, user_id)
    VALUES (${identityId}, ${channel}, 'schedule-proof', ${identityId}, ${userId})`);
  await query(sql`INSERT INTO scheduled_agent_jobs
    (id, workspace_id, created_by_user_id, conversation_channel, conversation_id, prompt, timing, status)
    VALUES (${jobId}, ${scope.workspaceId}, ${scope.userId}, ${channel}, ${identityId}, 'Report task',
    '{"kind":"once","at":"2030-01-01T00:00:00Z"}'::jsonb, 'completed')`);
  await query(sql`INSERT INTO scheduled_agent_runs (id, job_id, scheduled_for, status, report_status, outcome)
    VALUES (${runId}, ${jobId}, clock_timestamp(), 'completed', 'pending',
      ${sql`${JSON.stringify({
        kind: "result",
        summary: "s".repeat(4000),
        details: "d".repeat(5000),
        urgency: "normal",
      })}::jsonb`})`);
  await body({
    runId,
    jobId,
    identityId,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  });
};
const run = (
  body: Parameters<typeof fixture>[0],
  channel?: "telegram" | "kapso"
) => fixture(body, channel);
test.each(["telegram", "kapso"] as const)(
  "%s recovery keeps exact output IDs despite changed stored outcome",
  (channel) =>
    run(async ({ runId, identityId }) => {
      await Promise.all([
        dispatchNativeScheduledReport(runId),
        dispatchNativeScheduledReport(runId),
      ]);
      const first =
        await query(sql`SELECT b.chunk_index, b.outbox_id FROM scheduled_agent_report_outputs b
      WHERE run_id = ${runId} ORDER BY chunk_index`);
      expect(first).toHaveLength(3);
      await query(
        sql`UPDATE scheduled_agent_runs SET outcome = '{}'::jsonb WHERE id = ${runId}`
      );
      await dispatchNativeScheduledReport(runId);
      expect(
        await query(sql`SELECT b.chunk_index, b.outbox_id FROM scheduled_agent_report_outputs b
      WHERE run_id = ${runId} ORDER BY chunk_index`)
      ).toEqual(first);
      expect(
        await query(
          sql`SELECT id FROM channel_outbox WHERE identity_id = ${identityId}`
        )
      ).toHaveLength(3);
    }, channel)
);
test("outer PostgreSQL rollback removes both output chunks and their bindings", () =>
  run(async ({ runId, identityId }) => {
    await Promise.try(async () =>
      withDatabaseTransaction(async () => {
        await dispatchNativeScheduledReport(runId);
        throw new Error("interrupt before commit");
      })
    ).then(
      () => {
        throw new Error("Expected the operation to reject.");
      },
      (error: unknown) => error
    );
    expect(
      await query(
        sql`SELECT id FROM channel_outbox WHERE identity_id = ${identityId}`
      )
    ).toHaveLength(0);
    expect(
      await query(
        sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
      )
    ).toHaveLength(0);
    await dispatchNativeScheduledReport(runId);
    expect(
      await query(
        sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
      )
    ).toHaveLength(3);
  }));
test.each(["membership", "identity"] as const)(
  "revoked %s prevents waiting-input delivery",
  (revoke) =>
    run(async ({ runId, identityId, workspaceId, userId }) => {
      await query(
        sql`UPDATE scheduled_agent_runs SET status = 'waiting_for_input' WHERE id = ${runId}`
      );
      if (revoke === "membership")
        await query(
          sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`
        );
      else
        await query(
          sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`
        );
      await dispatchNativeScheduledReport(runId);
      const remaining = await query<{
        status: string;
      }>(
        sql`SELECT report_status AS status FROM scheduled_agent_runs WHERE id = ${runId}`
      );
      expect(remaining).toEqual(
        revoke === "membership" ? [] : [{ status: "cancelled" }]
      );
      expect(
        await query(
          sql`SELECT id FROM channel_outbox WHERE identity_id = ${identityId}`
        )
      ).toHaveLength(0);
    })
);
test("identity owner and current membership are independently required", () =>
  run(async ({ identityId, workspaceId, userId }) => {
    await requireScheduledChannelOwner({
      conversationChannel: "telegram",
      conversationId: identityId,
      createdByUserId: userId,
      workspaceId,
    });
    expect(
      await Promise.try(async () =>
        requireScheduledChannelOwner({
          conversationChannel: "telegram",
          conversationId: identityId,
          createdByUserId: "another-user",
          workspaceId,
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      _tag: "ScheduleOwnerInactive",
    });
    expect(
      await Promise.try(async () =>
        requireScheduledChannelOwner({
          conversationChannel: "telegram",
          conversationId: identityId,
          createdByUserId: userId,
          workspaceId: "another-workspace",
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      _tag: "ScheduleOwnerInactive",
    });
  }));
test("uncertain output blocks recovery and is never enqueued again", () =>
  run(async ({ runId, identityId }) => {
    const messaging = Messaging;
    await dispatchNativeScheduledReport(runId);
    const claim = await messaging.claimOutbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!claim) throw new Error("Expected durable output claim");
    await messaging.markOutboxUncertain({
      lease: {
        identityId,
        id: claim.id,
        leaseToken: claim.leaseToken,
      },
      reason: "handoff_unknown",
    });
    await dispatchNativeScheduledReport(runId);
    await dispatchNativeScheduledReport(runId);
    expect(
      (
        await query<{
          status: string;
        }>(
          sql`SELECT report_status AS status FROM scheduled_agent_runs WHERE id = ${runId}`
        )
      )[0]?.status
    ).toBe("uncertain");
    expect(
      await query(
        sql`SELECT id FROM channel_outbox WHERE identity_id = ${identityId}`
      )
    ).toHaveLength(3);
  }));
test("revocation cancels queued chunks and preserves their durable bindings", () =>
  run(async ({ runId, identityId }) => {
    const messaging = Messaging;
    await dispatchNativeScheduledReport(runId);
    const before = await query(
      sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId} ORDER BY chunk_index`
    );
    await query(
      sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`
    );
    expect(
      await messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      })
    ).toBeNull();
    await dispatchNativeScheduledReport(runId);
    expect(
      (
        await query<{
          status: string;
        }>(
          sql`SELECT report_status AS status FROM scheduled_agent_runs WHERE id = ${runId}`
        )
      )[0]?.status
    ).toBe("cancelled");
    expect(
      await query(
        sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId} ORDER BY chunk_index`
      )
    ).toEqual(before);
    expect(
      (
        await query<{
          status: string;
        }>(
          sql`SELECT status FROM channel_outbox WHERE identity_id = ${identityId}`
        )
      ).map((row) => row.status)
    ).toEqual(["cancelled", "cancelled", "cancelled"]);
  }));
test("membership deletion after enqueue denies transport before configuration or provider I/O", () =>
  run(async ({ runId, identityId, workspaceId, userId }) => {
    const transport = ChannelTransport;
    await dispatchNativeScheduledReport(runId);
    const before = await query<{
      id: string;
    }>(
      sql`SELECT id, payload FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY delivery_key`
    );
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`
    );
    expect(
      await Promise.try(async () =>
        transport.activeIdentity(identityId, "telegram")
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      reason: "identity_inactive",
    });
    for (const output of before) {
      expect(
        await Promise.try(async () => transport.drainOutbox(identityId)).then(
          () => {
            throw new Error("Expected the operation to reject.");
          },
          (error: unknown) => error
        )
      ).toMatchObject({
        reason: "identity_inactive",
      });
      expect(
        (
          await query<{
            status: string;
          }>(sql`SELECT status FROM channel_outbox WHERE id = ${output.id}`)
        )[0]?.status
      ).toBe("failed");
    }
    expect(
      await query(
        sql`SELECT id, payload FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY delivery_key`
      )
    ).toEqual(before);
    const statuses = await query<{
      status: string;
    }>(
      sql`SELECT status FROM channel_outbox WHERE identity_id = ${identityId}`
    );
    expect(
      statuses.every(
        (row) => row.status === "failed" || row.status === "cancelled"
      )
    ).toBe(true);
  }));
test.each(["last", "all"] as const)(
  "missing %s bindings block recovery without regenerating existing chunks",
  (missing) =>
    run(async ({ runId, identityId }) => {
      await dispatchNativeScheduledReport(runId);
      const before = await query(
        sql`SELECT id, payload FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY delivery_key`
      );
      if (missing === "all")
        await query(
          sql`DELETE FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
        );
      else
        await query(
          sql`DELETE FROM scheduled_agent_report_outputs WHERE run_id = ${runId} AND chunk_index = 2`
        );
      await query(
        sql`UPDATE scheduled_agent_runs SET outcome = '{}'::jsonb WHERE id = ${runId}`
      );
      await dispatchNativeScheduledReport(runId);
      expect(
        (
          await query<{
            status: string;
          }>(
            sql`SELECT report_status AS status FROM scheduled_agent_runs WHERE id = ${runId}`
          )
        )[0]?.status
      ).toBe("uncertain");
      expect(
        await query(
          sql`SELECT id, payload FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY delivery_key`
        )
      ).toEqual(before);
      expect(
        await query(
          sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
        )
      ).toHaveLength(missing === "all" ? 0 : 2);
    })
);
test.each(["telegram", "kapso"] as const)(
  "legacy report claim leaves %s pending until atomic native enqueue",
  (channel) =>
    run(async ({ runId }) => {
      expect(await getScheduledReportChannel(runId)).toBe(channel);
      expect(await claimScheduledReport(runId)).toBeUndefined();
      expect(
        (
          await query<{
            status: string;
            lease: string | null;
          }>(sql`SELECT report_status AS status, report_lease_token AS lease
      FROM scheduled_agent_runs WHERE id = ${runId}`)
        )[0]
      ).toEqual({
        status: "pending",
        lease: null,
      });
      expect(
        await query(
          sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
        )
      ).toHaveLength(0);
      await dispatchNativeScheduledReport(runId);
      expect(
        (
          await query<{
            status: string;
          }>(
            sql`SELECT report_status AS status FROM scheduled_agent_runs WHERE id = ${runId}`
          )
        )[0]?.status
      ).toBe("queued");
      expect(
        await query(
          sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
        )
      ).toHaveLength(3);
    }, channel)
);
test.each(["telegram", "kapso"] as const)(
  "%s report delivery attempts the durable outbox immediately and reconciles rejection",
  (channel) =>
    run(async ({ runId, identityId }) => {
      await query(
        sql`UPDATE scheduled_agent_runs SET outcome = ${sql`${JSON.stringify({
          kind: "result",
          summary: "Lembrete: revisar a demonstração do Companion.",
          urgency: "normal",
        })}::jsonb`} WHERE id = ${runId}`
      );
      // Actual provider adapter configuration is absent: it must reject before HTTP,
      // after the outbox transaction commits. No response or service is fabricated.
      const delivery = await Promise.try(async () =>
        deliverNativeScheduledReport(runId)
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      );
      expect(!delivery.ok).toBe(true);
      expect(
        await query(sql`SELECT status, attempts, payload->>'text' AS text, provider_message_id
      FROM channel_outbox WHERE identity_id = ${identityId}`)
      ).toEqual([
        {
          status: "failed",
          attempts: 1,
          text: "Lembrete: revisar a demonstração do Companion.",
          provider_message_id: null,
        },
      ]);
      expect(
        await query(
          sql`SELECT report_status FROM scheduled_agent_runs WHERE id = ${runId}`
        )
      ).toEqual([
        {
          report_status: "failed",
        },
      ]);
      expect(
        await query(
          sql`SELECT outbox_id FROM scheduled_agent_report_outputs WHERE run_id = ${runId}`
        )
      ).toHaveLength(1);
      await deliverNativeScheduledReport(runId);
      expect(
        await query(
          sql`SELECT status, attempts FROM channel_outbox WHERE identity_id = ${identityId}`
        )
      ).toEqual([
        {
          status: "failed",
          attempts: 1,
        },
      ]);
    }, channel)
);
test("native completion hook persists and attempts the report before returning", () =>
  run(async ({ runId, identityId, userId, workspaceId }) => {
    const leaseToken = randomUUID();
    const sessionId = randomUUID();
    await query(sql`UPDATE scheduled_agent_runs SET status = 'running', report_status = 'not_ready', outcome = NULL,
      lease_token = ${leaseToken}, lease_expires_at = clock_timestamp() + interval '1 minute', worker_session_id = ${sessionId}
      WHERE id = ${runId}`);
    // SAFETY: the hook reads only this synthetic event's session identity, turn and auth; all services are real.
    const context = (initiator: HookContext["session"]["auth"]["initiator"]) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Synthetic callback data supplies only the hook's consumed fields; database and transport are real.
      ({
        session: {
          id: sessionId,
          turn: {
            id: "turn-0",
            sequence: 0,
          },
          auth: {
            current: null,
            initiator,
          },
        },
      }) as HookContext;
    const handler = completionHook.events?.["message.completed"];
    expect(handler).toBeDefined();
    if (!handler) throw new Error("The completion hook is required.");
    await (async () => {
      await handler(
        {
          type: "message.completed",
          data: {
            turnId: "turn-0",
            stepIndex: 0,
            sequence: 1,
            finishReason: "stop",
            message: "Lembrete: revisar a demonstração do Companion.",
          },
          meta: {
            id: randomUUID(),
            at: new Date().toISOString(),
          },
        },
        context({
          authenticator: "scheduled-worker",
          principalId: userId,
          principalType: "user",
          attributes: {
            scheduledRunId: runId,
            scheduledRunLeaseToken: leaseToken,
            conversationChannel: "telegram",
            conversationId: identityId,
            channelIdentityId: identityId,
            workspaceId,
          },
        })
      );
    })();
    // The synthetic installation cannot match the configured real bot. The real
    // transport rejects before HTTP, proving this hook attempted the queued item.
    expect(
      await query(
        sql`SELECT status, report_status FROM scheduled_agent_runs WHERE id = ${runId}`
      )
    ).toEqual([
      {
        status: "completed",
        report_status: "failed",
      },
    ]);
    expect(
      await query(
        sql`SELECT status, attempts, provider_message_id FROM channel_outbox WHERE identity_id = ${identityId}`
      )
    ).toEqual([
      {
        status: "failed",
        attempts: 1,
        provider_message_id: null,
      },
    ]);
  }));

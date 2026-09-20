import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { expect, test } from "vitest";
import { listReminders } from "../../server/schedules/queries";
import { setReminderStatus } from "../../server/schedules/manage";
import { requireWorkspaceAccess } from "../../server/workspaces/access";
import { requireBrowserWorkerScheduleActive } from "../../server/browser-worker/access";

import { workspaceFixture } from "./workspace-fixture";

test("team schedules are visible together, editable by owners/admins, and isolated from personal work", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal } = workspace;
  const ownerJob = randomUUID();
  const memberJob = randomUUID();
  const privateJob = randomUUID();
  for (const [id, owner] of [
    [ownerJob, actor],
    [memberJob, guest],
    [privateJob, personal],
  ] as const) {
    await query(sql`INSERT INTO scheduled_agent_jobs(id, workspace_id, created_by_user_id, prompt, conversation_channel, conversation_id, timing, next_run_at)
        VALUES (${id}, ${owner.workspaceId}, ${owner.userId}, 'Synthetic schedule', 'eve', ${randomUUID()}, '{"kind":"once","at":"2030-01-01T12:00:00Z"}', '2030-01-01T12:00:00Z')`);
  }
  const page = await listReminders(guest);
  expect(new Set(page.reminders.map((job) => job.id))).toEqual(
    new Set([ownerJob, memberJob])
  );
  expect(page.reminders.find((job) => job.id === ownerJob)?.mayManage).toBe(
    false
  );
  expect(
    !(
      await Promise.try(async () =>
        setReminderStatus(guest, {
          id: ownerJob,
          revision: 0,
          status: "paused",
        })
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  expect(
    !(
      await Promise.try(async () =>
        setReminderStatus(actor, {
          id: privateJob,
          revision: 0,
          status: "paused",
        })
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  const paused = await setReminderStatus(actor, {
    id: memberJob,
    revision: 0,
    status: "paused",
  });
  expect(paused.status).toBe("paused");
  expect(
    !(
      await Promise.try(async () =>
        setReminderStatus(guest, {
          id: memberJob,
          revision: 0,
          status: "active",
        })
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  expect(
    (
      await setReminderStatus(guest, {
        id: memberJob,
        revision: paused.revision,
        status: "active",
      })
    ).nextRunAt?.toISOString()
  ).toBe("2030-01-01T12:00:00.000Z");
  await query(
    sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`
  );
  expect((await listReminders(guest)).reminders).toEqual([]);
  expect(
    !(
      await Promise.try(async () =>
        setReminderStatus(guest, {
          id: memberJob,
          revision: 2,
          status: "paused",
        })
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
});

test("a materialized one-shot job runs with its live lease, while pause, lease expiry and removal deny tools", async () => {
  await using workspace = await workspaceFixture();
  const { actor } = workspace;
  const id = randomUUID();
  const run = randomUUID();
  const lease = randomUUID();
  await query(sql`INSERT INTO scheduled_agent_jobs(id, workspace_id, created_by_user_id, prompt, conversation_channel, conversation_id, timing, status)
      VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, 'Synthetic one-shot', 'eve', ${randomUUID()}, '{"kind":"once","at":"2026-01-01T12:00:00Z"}', 'completed')`);
  await query(sql`INSERT INTO scheduled_agent_runs(id, job_id, scheduled_for, status, lease_token, lease_expires_at)
      VALUES (${run}, ${id}, now(), 'running', ${lease}, now() + interval '5 minutes')`);
  const worker = {
    userId: actor.userId,
    workspaceId: actor.workspaceId,
    scheduledRunId: run,
    scheduledRunLeaseToken: lease,
  };
  await requireWorkspaceAccess(worker);
  await requireBrowserWorkerScheduleActive(actor, id);
  await query(
    sql`UPDATE scheduled_agent_jobs SET status = 'paused' WHERE id = ${id}`
  );
  expect(
    !(
      await Promise.try(async () => requireWorkspaceAccess(worker)).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  await query(
    sql`UPDATE scheduled_agent_jobs SET status = 'completed' WHERE id = ${id}`
  );
  await query(
    sql`UPDATE scheduled_agent_runs SET lease_expires_at = now() - interval '1 second' WHERE id = ${run}`
  );
  expect(
    !(
      await Promise.try(async () => requireWorkspaceAccess(worker)).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  await query(
    sql`UPDATE scheduled_agent_runs SET lease_expires_at = now() + interval '5 minutes' WHERE id = ${run}`
  );
  await query(
    sql`DELETE FROM organization_memberships WHERE user_id = ${actor.userId}`
  );
  expect(
    !(
      await Promise.try(async () => requireWorkspaceAccess(worker)).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
});

import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  computeNextRun,
  scheduleTimingSchema,
} from "../../shared/schedules/timing";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";

export const ReminderStatusSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().min(0),
  status: z.enum(["active", "paused"]),
});
export class ScheduleChanged extends Error {
  readonly _tag = "ScheduleChanged";

  constructor() {
    super("ScheduleChanged");
    this.name = "ScheduleChanged";
  }
}

export const setReminderStatus = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof ReminderStatusSchema>
) {
  const input = await ReminderStatusSchema.parseAsync(raw);

  return await withDatabaseTransaction(async () => {
    const access = await requireWorkspaceAccess(actor);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    const jobs = await query<{
      owner: string;
      revision: number;
      timing: unknown;
    }>(sql`SELECT created_by_user_id AS owner, revision, timing
      FROM scheduled_agent_jobs WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId} AND status <> 'deleted' FOR UPDATE`);
    const job = jobs[0];
    if (!job || (job.owner !== actor.userId && access.role === "member"))
      throw new WorkspaceAccessDenied();
    if (job.revision !== input.revision) throw new ScheduleChanged();
    const now = new Date();
    const timing = await Promise.try(async () =>
      scheduleTimingSchema.parse(job.timing)
    ).catch(() => {
      throw new ScheduleChanged();
    });
    const nextRunAt =
      input.status === "active" ? computeNextRun(timing, now) : null;
    if (input.status === "active" && !nextRunAt) throw new ScheduleChanged();
    await query(sql`UPDATE scheduled_agent_jobs SET status = ${input.status}, next_run_at = ${nextRunAt},
      revision = revision + 1, updated_at = ${now} WHERE id = ${input.id}`);
    return { status: input.status, nextRunAt, revision: job.revision + 1 };
  });
};

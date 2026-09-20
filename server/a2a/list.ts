import {
  query as dbQuery,
  transaction as withDatabaseTransaction,
} from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../operations/async";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { createHash } from "node:crypto";

import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { A2AError, protocolTaskView, readProtocolTask } from "./tasks";

export const ListQuery = z.object({
  contextId: z.optional(z.uuid()),
  status: z.optional(
    z.enum([
      "TASK_STATE_SUBMITTED",
      "TASK_STATE_WORKING",
      "TASK_STATE_COMPLETED",
      "TASK_STATE_FAILED",
      "TASK_STATE_CANCELED",
      "TASK_STATE_INPUT_REQUIRED",
    ])
  ),
  pageSize: z.optional(z.number().int().min(1).max(100)),
  pageToken: z.optional(z.string().max(1024)),
  historyLength: z.optional(z.number().int().min(0)),
  statusTimestampAfter: z.optional(z.string().max(64)),
  includeArtifacts: z.optional(z.boolean()),
});
const cursorSchema = jsonString(
  z.object({
    id: z.uuid(),
    time: z.string(),
    filter: z.string(),
  })
);

export const listProtocolTasks = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof ListQuery> = {}
) {
  const query = await ListQuery.strict().parseAsync(raw);
  if (query.statusTimestampAfter)
    await z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .parseAsync(query.statusTimestampAfter);
  const filter = createHash("sha256")
    .update(
      JSON.stringify([
        actor.agentGrantId,
        query.contextId,
        query.status,
        query.statusTimestampAfter,
      ])
    )
    .digest("hex");
  const cursor = query.pageToken
    ? await cursorSchema.parseAsync(
        Buffer.from(query.pageToken, "base64url").toString("utf8")
      )
    : undefined;
  if (cursor) {
    await z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .parseAsync(cursor.time);
    if (cursor.filter !== filter)
      throw new A2AError({
        code: -32602,
        message: "Page token belongs to a different query",
      });
  }

  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor);
    if (!actor.agentGrantId) throw new WorkspaceAccessDenied();
    const pageSize = query.pageSize ?? 50;
    const matches = sql`grant_id = ${actor.agentGrantId}
      AND (${query.contextId ?? null}::uuid IS NULL OR context_id = ${query.contextId ?? null}::uuid)
      AND (${query.status ?? null}::text IS NULL OR state = ${query.status ?? null})
      AND (${query.statusTimestampAfter ?? null}::timestamptz IS NULL OR updated_at >= ${query.statusTimestampAfter ?? null}::timestamptz)`;
    const count = await dbQuery<{
      total: number;
    }>(
      sql`SELECT count(*)::int AS total FROM agent_protocol_tasks WHERE ${matches}`
    );
    const rows = await dbQuery<{ id: string; time: string }>(sql`SELECT id,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time
      FROM agent_protocol_tasks WHERE ${matches}
      AND (${cursor?.id ?? null}::uuid IS NULL OR (updated_at, id) < (${cursor?.time ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      ORDER BY updated_at DESC, id DESC LIMIT ${pageSize + 1}`);
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      tasks: await mapAsync(
        page,
        ({ id }) =>
          Promise.try(async () => readProtocolTask(actor, id)).then((task) =>
            protocolTaskView(task, query.includeArtifacts ?? false)
          ),
        1
      ),
      pageSize,
      totalSize: count[0]?.total ?? 0,
      nextPageToken:
        rows.length > pageSize && last
          ? Buffer.from(JSON.stringify({ ...last, filter })).toString(
              "base64url"
            )
          : "",
    };
  });
};

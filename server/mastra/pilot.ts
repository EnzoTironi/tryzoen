import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createWorkflowStateReader } from "@mastra/core/workflows";
import { db } from "@db";
import { query, transaction } from "@db/queries";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { resolveWorkspaceActor } from "../workspaces/session";
import { WorkspaceRepository } from "../workspaces/repository";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  pilotCommandSchema,
  pilotConversationSchema,
  pilotPlanSchema,
  pilotResultSchema,
  pilotRunSchema,
  pilotViewSchema,
} from "./contract";
import { mastraPilotRuntime, pilotRequestContext } from "./runtime";

class PilotBusy extends Error {
  constructor() {
    super(
      "A conversa tem uma solicitação em andamento. Revise ou cancele antes de continuar."
    );
    this.name = "PilotBusy";
  }
}

async function personalActor(headers: Headers) {
  const actor = await resolveWorkspaceActor(headers, "personal");
  if (accessScopeForUser(actor.userId).workspaceId !== actor.workspaceId)
    throw new WorkspaceAccessDenied();
  return actor;
}
async function ownedRun(
  actor: z.output<typeof WorkspaceActorSchema>,
  runId: string
) {
  await requireWorkspaceAccess(actor);
  const [row] =
    await query(sql`SELECT r.id AS "runId",r.conversation_id AS "conversationId",r.input,r.status,r.created_at::text AS "createdAt",r.decision
    FROM mastra_pilot_run r JOIN agent_sessions s ON s.session_id=r.conversation_id
    WHERE r.id=${runId} AND s.workspace_id=${actor.workspaceId} AND s.created_by_user_id=${actor.userId}`);
  if (!row) throw new WorkspaceAccessDenied();
  return pilotRunSchema
    .extend({ decision: z.enum(["approve", "reject"]).nullable() })
    .parse({ ...row, plan: null, result: null });
}

/** A database lock serializes replay/resume across processes, without a model-long transaction. */
async function exclusive<Result>(key: string, run: () => Promise<Result>) {
  const client = await db.$client.connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      ["mastra:" + key]
    );
    if (!result.rows[0]?.locked) throw new PilotBusy();
    try {
      return await run();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        "mastra:" + key,
      ]);
    }
  } finally {
    client.release();
  }
}

export async function readMastraPilot(
  headers: Headers,
  requestedConversation?: string | null
) {
  const actor = await personalActor(headers);
  const conversations = z.array(pilotConversationSchema).parse(
    await query(sql`SELECT c.id,c.title FROM mastra_pilot_conversation c
    JOIN agent_sessions s ON s.session_id=c.id WHERE s.workspace_id=${actor.workspaceId} AND s.created_by_user_id=${actor.userId}
    ORDER BY c.created_at DESC,c.id DESC LIMIT 30`)
  );
  const conversationId = requestedConversation
    ? z.uuid().parse(requestedConversation)
    : (conversations[0]?.id ?? null);
  if (
    conversationId &&
    !conversations.some((item) => item.id === conversationId)
  )
    throw new WorkspaceAccessDenied();
  const runs = [];
  if (conversationId) {
    const records = await query<{ id: string }>(
      sql`SELECT id FROM mastra_pilot_run WHERE conversation_id=${conversationId} ORDER BY created_at DESC,id DESC LIMIT 30`
    );
    const { mastra } = await mastraPilotRuntime();
    const workflow = mastra.getWorkflow("pilot");
    for (const record of records.toReversed()) {
      const row = await ownedRun(actor, record.id);
      const state = await workflow.getWorkflowRunById(row.runId);
      if (!state) {
        runs.push(row);
        continue;
      }
      const reader = createWorkflowStateReader(state);
      // Reconcile a checkpoint persisted just before the serving process exited.
      if (row.status === "running" || row.status === "suspended") {
        const status =
          state.status === "suspended"
            ? "suspended"
            : state.status === "success"
              ? row.decision === "reject"
                ? "rejected"
                : "completed"
              : state.status === "failed"
                ? "failed"
                : state.status === "canceled"
                  ? "cancelled"
                  : row.status;
        if (status !== row.status) {
          await transaction(async () => {
            await requireWorkspaceAccess(actor);
            await query(
              sql`UPDATE mastra_pilot_run SET status=${status} WHERE id=${row.runId} AND status IN ('running','suspended')`
            );
          });
          row.status = status;
        }
      }
      const plan = pilotPlanSchema.safeParse(reader.getStepOutput("plan"));
      const result = pilotResultSchema.safeParse(
        reader.getStepOutput("commit")
      );
      runs.push({
        ...row,
        plan: plan.success ? plan.data : null,
        result: result.success ? result.data : null,
      });
    }
  }
  await requireWorkspaceAccess(actor);
  return pilotViewSchema.parse({ conversations, conversationId, runs });
}

export async function downloadMastraNote(headers: Headers, runId: string) {
  const actor = await personalActor(headers);
  const row = await ownedRun(actor, z.uuid().parse(runId));
  const { mastra } = await mastraPilotRuntime();
  const state = await mastra.getWorkflow("pilot").getWorkflowRunById(row.runId);
  if (!state || row.status !== "completed") throw new WorkspaceAccessDenied();
  const reader = createWorkflowStateReader(state);
  const plan = pilotPlanSchema.parse(reader.getStepOutput("plan"));
  const result = pilotResultSchema.parse(reader.getStepOutput("commit"));
  if (plan.action?.kind !== "note" || !result.receipt)
    throw new WorkspaceAccessDenied();
  const document = await WorkspaceRepository.read(
    actor,
    plan.action.path,
    result.receipt.revision
  );
  if (document.content === null) throw new WorkspaceAccessDenied();
  await requireWorkspaceAccess(actor);
  return new Response(document.content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="zoen-note-${row.runId}.md"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function commandMastraPilot(
  headers: Headers,
  raw: z.output<typeof pilotCommandSchema>
) {
  const input = pilotCommandSchema.parse(raw);
  const actor = await personalActor(headers);
  if (input.command === "create") {
    const id = randomUUID();
    await transaction(async () => {
      await requireWorkspaceAccess(actor);
      await query(
        sql`INSERT INTO agent_sessions (session_id,workspace_id,created_by_user_id) VALUES (${id},${actor.workspaceId},${actor.userId})`
      );
      await query(
        sql`INSERT INTO mastra_pilot_conversation (id,title) VALUES (${id},'Nova conversa')`
      );
    });
    return readMastraPilot(headers, id);
  }
  const { mastra } = await mastraPilotRuntime();
  const workflow = mastra.getWorkflow("pilot");
  if (input.command === "cancel") {
    const row = await ownedRun(actor, input.runId);
    await transaction(async () => {
      await requireWorkspaceAccess(actor);
      await query(
        sql`UPDATE mastra_pilot_run SET status='cancelled' WHERE id=${row.runId} AND decision IS NULL AND status IN ('running','suspended')`
      );
    });
    const current = await ownedRun(actor, input.runId);
    if (current.status === "cancelled") {
      const run = await workflow.createRun({ runId: row.runId });
      await run.cancel();
    }
    return readMastraPilot(headers, row.conversationId);
  }
  return exclusive(
    input.command === "send" ? input.conversationId : input.runId,
    async () => {
      let row: Awaited<ReturnType<typeof ownedRun>>;
      if (input.command === "send") {
        await transaction(async () => {
          await requireWorkspaceAccess(actor);
          const owned =
            await query(sql`SELECT c.id FROM mastra_pilot_conversation c JOIN agent_sessions s ON s.session_id=c.id
          WHERE c.id=${input.conversationId} AND s.workspace_id=${actor.workspaceId} AND s.created_by_user_id=${actor.userId} FOR SHARE OF s,c`);
          if (!owned.length) throw new WorkspaceAccessDenied();
          const existing = await query(
            sql`SELECT id FROM mastra_pilot_run WHERE id=${input.runId}`
          );
          if (existing.length) {
            const prior = await ownedRun(actor, input.runId);
            if (
              prior.conversationId !== input.conversationId ||
              prior.input !== input.text
            )
              throw new WorkspaceAccessDenied();
            return;
          }
          const active = await query(
            sql`SELECT id FROM mastra_pilot_run WHERE conversation_id=${input.conversationId} AND status IN ('running','suspended')`
          );
          if (active.length) throw new PilotBusy();
          await query(
            sql`INSERT INTO mastra_pilot_run (id,conversation_id,input,status) VALUES (${input.runId},${input.conversationId},${input.text},'running')`
          );
          await query(
            sql`UPDATE mastra_pilot_conversation SET title=${input.text.slice(0, 70)} WHERE id=${input.conversationId} AND title='Nova conversa'`
          );
        });
        row = await ownedRun(actor, input.runId);
        const state = await workflow.getWorkflowRunById(row.runId);
        if (state) return readMastraPilot(headers, row.conversationId);
      } else {
        row = await ownedRun(actor, input.runId);
        if (
          ["completed", "rejected", "cancelled", "failed"].includes(row.status)
        )
          return readMastraPilot(headers, row.conversationId);
        const decision = input.approved ? "approve" : "reject";
        const state = await workflow.getWorkflowRunById(row.runId);
        if (
          !state ||
          !["suspended", "running", "success"].includes(state.status)
        )
          throw new PilotBusy();
        if (row.decision && row.decision !== decision) throw new PilotBusy();
        if (state.status !== "suspended" && !row.decision)
          throw new PilotBusy();
        await transaction(async () => {
          await requireWorkspaceAccess(actor);
          const updated =
            await query(sql`UPDATE mastra_pilot_run SET decision=${decision} WHERE id=${row.runId}
          AND status IN ('running','suspended') AND (decision IS NULL OR decision=${decision}) RETURNING id`);
          if (updated.length !== 1) throw new PilotBusy();
        });
      }
      const run = await workflow.createRun({ runId: row.runId });
      try {
        const context = pilotRequestContext(actor);
        const state = await workflow.getWorkflowRunById(row.runId);
        const result =
          input.command === "send"
            ? await run.start({
                inputData: {
                  runId: row.runId,
                  conversationId: row.conversationId,
                  text: row.input,
                  occurredAt: new Date(row.createdAt).toISOString(),
                },
                requestContext: context,
              })
            : state?.status === "suspended"
              ? await run.resume({
                  step: "review",
                  resumeData: { approved: input.approved },
                  requestContext: context,
                })
              : state?.status === "success"
                ? state
                : await run.restart({ requestContext: context });
        const status =
          result.status === "suspended"
            ? "suspended"
            : result.status === "success"
              ? input.command === "decide" && !input.approved
                ? "rejected"
                : "completed"
              : result.status === "canceled"
                ? "cancelled"
                : "failed";
        await query(
          sql`UPDATE mastra_pilot_run SET status=${status} WHERE id=${row.runId} AND status<>'cancelled'`
        );
      } catch {
        await query(
          sql`UPDATE mastra_pilot_run SET status='failed' WHERE id=${row.runId} AND status<>'cancelled'`
        );
      }
      return readMastraPilot(headers, row.conversationId);
    }
  );
}

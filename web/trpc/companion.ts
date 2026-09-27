import { and, desc, eq, ilike, isNotNull, lt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { agentSessions, chats, db, workstreams } from "@db";
import {
  readWorkstream,
  saveWorkstream,
  WorkstreamConflict,
  workstreamHistory,
  forgetWorkstream,
} from "@db/services/workstreams";
import {
  workstreamIdSchema,
  saveWorkstreamSchema,
} from "@shared/workstreams/schema";
import { scheduledRunOutcomeSchema } from "@shared/schedules/outcome";
import {
  companionChatsSchema,
  companionGoalsSchema,
  companionFeedSchema,
  companionIdentitySchema,
  companionGoalHistorySchema,
} from "@shared/companion/schema";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { workspaceProcedure } from "./workspace-procedure";
import { listPersonalIdeas, ratePersonalIdea } from "@db/services/ideas";
import {
  ideaPageSchema,
  ideaCursorSchema,
  ideaFeedbackInputSchema,
} from "@zoen/companion-ui/ideas";
import {
  readGoalPreferences,
  saveGoalPreference,
} from "@db/services/goal-preferences";
import {
  goalPreferencesSchema,
  goalPreferenceChangeSchema,
} from "@zoen/companion-ui/goals";

// Product queries use the same ownership and storage boundaries as agent tools.
export const companionRouter = {
  ideas: workspaceProcedure
    .input(z.object({ cursor: ideaCursorSchema.nullish() }))
    .output(ideaPageSchema)
    .query(({ ctx, input }) => listPersonalIdeas(ctx.actor, input.cursor)),
  rateIdea: workspaceProcedure
    .input(ideaFeedbackInputSchema)
    .mutation(({ ctx, input }) => ratePersonalIdea(ctx.actor, input)),
  goalPreferences: workspaceProcedure
    .output(goalPreferencesSchema)
    .query(({ ctx }) => readGoalPreferences(ctx.scope)),
  setGoalPreference: workspaceProcedure
    .input(goalPreferenceChangeSchema)
    .output(goalPreferencesSchema)
    .mutation(({ ctx, input }) => saveGoalPreference(ctx.scope, input)),
  identity: workspaceProcedure
    .output(companionIdentitySchema)
    .query(async ({ ctx }) => ({
      ...(await WorkspaceRepository.selection(ctx.actor, [
        "agent/IDENTITY.md",
        "agent/SOUL.md",
        "agent/MEMORY.md",
      ])),
      canEdit: ctx.actor.role !== "member",
    })),
  chats: workspaceProcedure
    .input(
      z.object({
        query: z.string().trim().max(200).default(""),
        cursor: z
          .object({
            updatedAt: z.iso.datetime(),
            sessionId: z.string().min(1).max(200),
          })
          .nullish(),
      })
    )
    .output(companionChatsSchema)
    .query(async ({ ctx, input }) => {
      const cursor = input.cursor;
      const pattern = `%${input.query.replace(/[\\%_]/gu, "\\$&")}%`;
      const rows = await db
        .select({
          sessionId: chats.sessionId,
          title: chats.title,
          updatedAt: chats.updatedAt,
        })
        .from(chats)
        .innerJoin(agentSessions, eq(agentSessions.sessionId, chats.sessionId))
        .where(
          and(
            eq(chats.workspaceId, ctx.scope.workspaceId),
            eq(agentSessions.workspaceId, ctx.scope.workspaceId),
            eq(agentSessions.createdByUserId, ctx.scope.userId),
            input.query ? ilike(chats.title, pattern) : undefined,
            cursor
              ? or(
                  lt(chats.updatedAt, new Date(cursor.updatedAt)),
                  and(
                    eq(chats.updatedAt, new Date(cursor.updatedAt)),
                    lt(chats.sessionId, cursor.sessionId)
                  )
                )
              : undefined
          )
        )
        .orderBy(desc(chats.updatedAt), desc(chats.sessionId))
        .limit(31);
      const items = rows.slice(0, 30).map((row) => ({
        sessionId: row.sessionId,
        title: row.title,
        updatedAt: row.updatedAt.toISOString(),
      }));
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > 30 && last
            ? { updatedAt: last.updatedAt, sessionId: last.sessionId }
            : null,
      };
    }),
  goals: workspaceProcedure
    .output(companionGoalsSchema)
    .query(async ({ ctx }) => {
      const rows = await db
        .select()
        .from(workstreams)
        .where(
          and(
            eq(workstreams.workspaceId, ctx.scope.workspaceId),
            isNotNull(workstreams.content)
          )
        )
        .orderBy(desc(workstreams.updatedAt), workstreams.id)
        .limit(100);
      return rows.map(({ id, scopeKey, revision, content, sessionId }) => ({
        id,
        scopeKey,
        revision,
        content,
        sessionId,
      }));
    }),
  setGoalCompleted: workspaceProcedure
    .input(
      z.object({
        id: workstreamIdSchema,
        scopeKey: z.string().min(1).max(1024),
        expectedRevision: z.number().int().positive(),
        completed: z.boolean(),
        operationId: z.uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const current = await readWorkstream(ctx.scope, input.scopeKey, input.id);
      if (!current?.content) throw new TRPCError({ code: "NOT_FOUND" });
      return saveWorkstream(
        ctx.scope,
        input.scopeKey,
        {
          id: input.id,
          expectedRevision: input.expectedRevision,
          content: {
            ...current.content,
            status: input.completed ? "completed" : "active",
            progress: {
              title: input.completed
                ? `Completed ${current.content.title}`
                : `Reopened ${current.content.title}`,
              description:
                current.content.nextStep || current.content.objective,
            },
          },
        },
        input.operationId,
        current.sessionId
      ).catch((error: unknown) => {
        if (error instanceof WorkstreamConflict)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This goal changed. Refresh before updating it.",
            cause: error,
          });
        throw error;
      });
    }),
  goalHistory: workspaceProcedure
    .input(
      z.object({
        id: workstreamIdSchema,
        scopeKey: z.string().min(1).max(1024),
        beforeRevision: z.number().int().positive().optional(),
      })
    )
    .output(companionGoalHistorySchema)
    .query(async ({ ctx, input }) => {
      if (!(await readWorkstream(ctx.scope, input.scopeKey, input.id)))
        throw new TRPCError({ code: "NOT_FOUND" });
      return workstreamHistory(
        ctx.scope,
        input.scopeKey,
        input.id,
        input.beforeRevision
      );
    }),
  renameGoal: workspaceProcedure
    .input(
      z.object({
        id: workstreamIdSchema,
        scopeKey: z.string().min(1).max(1024),
        expectedRevision: z.number().int().positive(),
        title: saveWorkstreamSchema.shape.content.shape.title,
        operationId: z.uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const current = await readWorkstream(ctx.scope, input.scopeKey, input.id);
      if (!current?.content) throw new TRPCError({ code: "NOT_FOUND" });
      try {
        return await saveWorkstream(
          ctx.scope,
          input.scopeKey,
          {
            id: input.id,
            expectedRevision: input.expectedRevision,
            content: {
              ...current.content,
              title: input.title,
              progress: {
                title: `Renamed to ${input.title}`,
                description: `Previously ${current.content.title}`,
              },
            },
          },
          input.operationId,
          current.sessionId
        );
      } catch (error) {
        if (error instanceof WorkstreamConflict)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This goal changed. Refresh before updating it.",
            cause: error,
          });
        throw error;
      }
    }),
  deleteGoal: workspaceProcedure
    .input(
      z.object({
        id: workstreamIdSchema,
        scopeKey: z.string().min(1).max(1024),
        expectedRevision: z.number().int().positive(),
        operationId: z.uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const current = await readWorkstream(ctx.scope, input.scopeKey, input.id);
      if (!current) return { forgotten: true };
      return forgetWorkstream(
        ctx.scope,
        input.scopeKey,
        { id: input.id, expectedRevision: input.expectedRevision },
        input.operationId
      ).catch((error: unknown) => {
        if (error instanceof WorkstreamConflict)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This goal changed. Refresh before deleting it.",
            cause: error,
          });
        throw error;
      });
    }),
  feed: workspaceProcedure
    .input(
      z.object({
        cursor: z.object({ date: z.iso.datetime(), id: z.uuid() }).nullish(),
      })
    )
    .output(companionFeedSchema)
    .query(async ({ ctx, input }) => {
      const result = await db.execute(sql`
      SELECT r.id, j.prompt AS title, r.outcome, r.scheduled_for AS date,
        CASE WHEN j.conversation_channel = 'eve' AND EXISTS (
          SELECT 1 FROM agent_sessions s WHERE s.session_id = j.conversation_id
          AND s.workspace_id = ${ctx.scope.workspaceId} AND s.created_by_user_id = ${ctx.scope.userId}
        ) THEN j.conversation_id ELSE NULL END AS "sessionId"
      FROM scheduled_agent_runs r JOIN scheduled_agent_jobs j ON j.id = r.job_id
      INNER JOIN workspace_memberships m ON m.workspace_id = j.workspace_id AND m.user_id = j.created_by_user_id
      WHERE j.workspace_id = ${ctx.scope.workspaceId} AND j.created_by_user_id = ${ctx.scope.userId}
        AND r.status = 'completed' AND r.outcome IS NOT NULL
        AND r.outcome->>'kind' <> 'nothing_to_report'
        ${input.cursor ? sql`AND (r.scheduled_for, r.id) < (${input.cursor.date}::timestamptz, ${input.cursor.id})` : sql``}
      ORDER BY r.scheduled_for DESC, r.id DESC LIMIT 21`);
      const rows = z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            outcome: scheduledRunOutcomeSchema,
            date: z.coerce.date(),
            sessionId: z.string().nullable(),
          })
        )
        .parse(result.rows);
      const last = rows[19];
      return {
        items: rows.slice(0, 20).map((row) => ({
          id: row.id,
          title: row.title,
          outcome: row.outcome,
          sessionId: row.sessionId,
          date: row.date.toISOString(),
        })),
        nextCursor:
          rows.length > 20 && last
            ? { date: last.date.toISOString(), id: last.id }
            : null,
      };
    }),
};

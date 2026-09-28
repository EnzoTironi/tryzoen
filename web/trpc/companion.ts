import { withSignal } from "../../server/operations/async";
import {
  chatQuerySchema,
  chatPageSchema,
  chatChangeSchema,
} from "@zoen/companion-ui/chats";
import { listChatLibrary, changeChat } from "@db/services/chat-library";
import { listConversationInbox } from "@db/services/inbox";
import { inboxQuerySchema, inboxPageSchema } from "@zoen/companion-ui/inbox";
import {
  feedCursorSchema,
  feedPageSchema,
  feedInstructionsSchema,
} from "@zoen/companion-ui/feed";
import {
  reactionReadSchema,
  reactionWriteSchema,
  reactionPageSchema,
  messageReactionSchema,
} from "@zoen/companion-ui/reactions";
import {
  readMessageReactions,
  setMessageReaction,
} from "@db/services/message-reactions";
import {
  listFeedPosts,
  likeFeedPost,
  deleteFeedPost,
  readFeedInstructions,
  saveFeedInstructions,
} from "@db/services/feed";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db, workstreams } from "@db";
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
import {
  companionGoalsSchema,
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
  inbox: workspaceProcedure
    .input(inboxQuerySchema)
    .output(inboxPageSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => listConversationInbox(ctx.actor, input))
    ),
  reactions: workspaceProcedure
    .input(reactionReadSchema)
    .output(reactionPageSchema)
    .query(({ ctx, input }) => readMessageReactions(ctx.scope, input)),
  setReaction: workspaceProcedure
    .input(reactionWriteSchema)
    .output(messageReactionSchema)
    .mutation(({ ctx, input }) => setMessageReaction(ctx.scope, input)),
  feedInstructions: workspaceProcedure
    .output(feedInstructionsSchema)
    .query(({ ctx }) => readFeedInstructions(ctx.actor)),
  saveFeedInstructions: workspaceProcedure
    .input(feedInstructionsSchema)
    .output(feedInstructionsSchema)
    .mutation(({ ctx, input }) => saveFeedInstructions(ctx.actor, input)),
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
    .input(chatQuerySchema)
    .output(chatPageSchema)
    .query(({ ctx, input }) => listChatLibrary(ctx.scope, input)),
  changeChat: workspaceProcedure
    .input(chatChangeSchema)
    .mutation(({ ctx, input }) => changeChat(ctx.scope, input)),
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
    .input(z.object({ cursor: feedCursorSchema.nullish() }))
    .output(feedPageSchema)
    .query(({ ctx, input }) => listFeedPosts(ctx.actor, input.cursor)),
  likePost: workspaceProcedure
    .input(z.object({ id: z.uuid(), liked: z.boolean() }))
    .mutation(({ ctx, input }) =>
      likeFeedPost(ctx.actor, input.id, input.liked)
    ),
  deletePost: workspaceProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => deleteFeedPost(ctx.actor, input.id)),
};

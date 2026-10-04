import {
  linkPreviewInputSchema,
  linkPreviewSchema,
} from "@zoen/companion-ui/previews";
import { readLinkPreview } from "../../server/links/preview";
import {
  referenceSearchSchema,
  referenceResultsSchema,
} from "@zoen/companion-ui/references";
import { searchComposerReferences } from "../../server/workspaces/references";
import {
  GitRevisionSchema,
  WorkspacePathSchema,
} from "@zoen/companion-ui/workspace-files";
import {
  reminderStatusSchema,
  reminderHistoryInputSchema,
} from "@shared/schedules/reminders";
import {
  listReminders,
  readReminderHistory,
} from "../../server/schedules/queries";
import {
  LearnedClaimReadInputSchema,
  LearnedClaimReadSchema,
  LearnedClaimSearchInputSchema,
  LearnedClaimSearchSchema,
  LearnedClaimChangeSchema,
  LearnedClaimChangeResultSchema,
  LearnedClaimHistoryInputSchema,
  LearnedClaimHistorySchema,
  LearnedClaimSetEnabledInputSchema,
  LearnedClaimSetEnabledResultSchema,
  LearnedClaimIndexRepairSchema,
} from "@zoen/companion-ui/memory";
import { withSignal } from "../../server/operations/async";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { WorkspaceRepositoryError } from "../../server/workspaces/repository";
import { ScheduleChanged } from "../../server/schedules/manage";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createUserWorkspace,
  listUserWorkspaces,
  WorkspaceCreationSchema,
} from "../../server/workspaces/directory";
import {
  WorkspaceRepository,
  WorkspaceWriteSchema,
} from "../../server/workspaces/repository";
import {
  listSkillProposals,
  publishSkillProposal,
  PublishSkillProposalSchema,
  rollbackSkill,
  RollbackSkillSchema,
} from "../../server/workspaces/skills";

import { workspaceProcedure } from "./workspace-procedure";
import { workspaceRoomsRouter } from "./workspace-rooms";
import { workspaceToolsRouter } from "./workspace-tools";
import { workspaceAgentsRouter } from "./workspace-agents";
import { creatorsRouter } from "./creators";
import { readWorkspaceCapabilities } from "../../server/workspaces/capabilities";
import { setReminderStatus } from "../../server/schedules/manage";
import {
  DirectoryProfileSchema,
  UsernameSchema,
  readDirectoryProfile,
  saveDirectoryProfile,
  searchDirectory,
} from "../../server/accounts/directory";
import {
  answerWorkspaceInvitation,
  inviteWorkspaceMember,
  readWorkspaceInvitations,
  readWorkspaceTeam,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
} from "../../server/workspaces/team";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import { PrivateMemoryError } from "../../server/memory/errors";
import {
  listKnowledgeProposals,
  readKnowledgeProposal,
  reviewKnowledgeProposal,
  ReviewKnowledgeSchema,
} from "../../server/workspaces/knowledge";
import { knowledgeProposalPathSchema } from "@zoen/companion-ui/knowledge";
async function memoryRpc<Result>(run: () => Promise<Result>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WorkspaceAccessDenied)
      throw new TRPCError({ code: "FORBIDDEN" });
    if (!(error instanceof PrivateMemoryError)) throw error;
    switch (error.reason) {
      case "conflict":
      case "stale_recall":
        throw new TRPCError({
          code: "CONFLICT",
          message: "Memory changed. Review the current state before retrying.",
        });
      case "invalid_input":
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid private memory request.",
        });
      case "disabled":
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Automatic memory is paused.",
        });
      case "unavailable":
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Private memory is unavailable.",
        });
      default: {
        const unhandled: never = error.reason;
        throw new Error(
          `Unknown private memory failure: ${String(unhandled)}`,
          {
            cause: error,
          }
        );
      }
    }
  }
}

export const workspacesRouter = {
  knowledge: {
    proposals: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, () => listKnowledgeProposals(ctx.actor))
    ),
    proposal: workspaceProcedure
      .input(z.object({ path: knowledgeProposalPathSchema }))
      .query(({ ctx, input, signal }) =>
        withSignal(signal, () => readKnowledgeProposal(ctx.actor, input.path))
      ),
    review: workspaceProcedure
      .input(ReviewKnowledgeSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            return await reviewKnowledgeProposal(ctx.actor, input);
          } catch (error) {
            if (error instanceof WorkspaceRepositoryError)
              throw new TRPCError({
                code: error.reason === "conflict" ? "CONFLICT" : "BAD_REQUEST",
                message:
                  error.reason === "conflict"
                    ? "The files changed. Refresh this proposal before reviewing it."
                    : "Unable to review this proposal.",
              });
            throw error;
          }
        })
      ),
  },
  linkPreview: workspaceProcedure
    .input(linkPreviewInputSchema)
    .output(linkPreviewSchema)
    .query(({ ctx, input, signal }) =>
      readLinkPreview(ctx.actor, input.url, signal)
    ),
  references: workspaceProcedure
    .input(referenceSearchSchema)
    .output(referenceResultsSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => searchComposerReferences(ctx.actor, input))
    ),
  creators: creatorsRouter,
  tools: workspaceToolsRouter,
  rooms: workspaceRoomsRouter,
  ...workspaceAgentsRouter,
  schedules: {
    history: workspaceProcedure
      .input(reminderHistoryInputSchema)
      .query(({ ctx, input, signal }) =>
        withSignal(signal, () => readReminderHistory(ctx.scope, input))
      ),
    list: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, () => listReminders(ctx.scope))
    ),
    setStatus: workspaceProcedure
      .input(reminderStatusSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            return await setReminderStatus(ctx.actor, input);
          } catch (error) {
            if (error instanceof ScheduleChanged)
              throw new TRPCError({
                code: "CONFLICT",
              });
            throw error;
          }
        })
      ),
  },
  profile: {
    read: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => readDirectoryProfile(ctx.actor))
    ),
    save: workspaceProcedure
      .input(DirectoryProfileSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => saveDirectoryProfile(ctx.actor, input))
      ),
    search: workspaceProcedure
      .input(
        z.object({
          query: z.string().max(30),
        })
      )
      .query(({ ctx, input, signal }) =>
        withSignal(signal, async () => searchDirectory(ctx.actor, input.query))
      ),
  },
  team: {
    revoke: workspaceProcedure
      .input(
        z.object({
          id: z.uuid(),
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () =>
          revokeWorkspaceInvitation(ctx.actor, input.id)
        )
      ),
    list: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => readWorkspaceTeam(ctx.actor))
    ),
    invitations: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => readWorkspaceInvitations(ctx.actor))
    ),
    invite: workspaceProcedure
      .input(
        z.object({
          username: UsernameSchema,
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () =>
          inviteWorkspaceMember(ctx.actor, input.username)
        )
      ),
    answer: workspaceProcedure
      .input(
        z.object({
          id: z.uuid(),
          accept: z.boolean(),
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () =>
          answerWorkspaceInvitation(ctx.actor, input.id, input.accept)
        )
      ),
    remove: workspaceProcedure
      .input(
        z.object({
          userId: z.string().min(1).max(200),
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () =>
          removeWorkspaceMember(ctx.actor, input.userId)
        )
      ),
  },
  capabilities: workspaceProcedure.query(({ ctx, signal }) =>
    withSignal(signal, async () => readWorkspaceCapabilities(ctx.actor))
  ),
  memory: {
    read: workspaceProcedure
      .input(LearnedClaimReadInputSchema.optional())
      .output(LearnedClaimReadSchema)
      .query(({ ctx, input, signal }) =>
        withSignal(signal, () =>
          memoryRpc(() => PrivateMemoryRepository.read(ctx.actor, input ?? {}))
        )
      ),
    search: workspaceProcedure
      .input(LearnedClaimSearchInputSchema)
      .output(LearnedClaimSearchSchema)
      .query(({ ctx, input, signal }) =>
        withSignal(signal, () =>
          memoryRpc(() => PrivateMemoryRepository.search(ctx.actor, input))
        )
      ),
    history: workspaceProcedure
      .input(LearnedClaimHistoryInputSchema)
      .output(LearnedClaimHistorySchema)
      .query(({ ctx, input, signal }) =>
        withSignal(signal, () =>
          memoryRpc(() =>
            PrivateMemoryRepository.history(ctx.actor, input.claimId)
          )
        )
      ),
    change: workspaceProcedure
      .input(LearnedClaimChangeSchema)
      .output(LearnedClaimChangeResultSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, () =>
          memoryRpc(() => PrivateMemoryRepository.change(ctx.actor, input))
        )
      ),
    setEnabled: workspaceProcedure
      .input(LearnedClaimSetEnabledInputSchema)
      .output(LearnedClaimSetEnabledResultSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, () =>
          memoryRpc(() => PrivateMemoryRepository.setEnabled(ctx.actor, input))
        )
      ),
    repairIndex: workspaceProcedure
      .output(LearnedClaimIndexRepairSchema)
      .mutation(({ ctx, signal }) =>
        withSignal(signal, () =>
          memoryRpc(() => PrivateMemoryRepository.rebuildOperations(ctx.actor))
        )
      ),
  },
  list: workspaceProcedure.query(({ ctx, signal }) =>
    withSignal(signal, async () => listUserWorkspaces(ctx.actor))
  ),
  create: workspaceProcedure
    .input(WorkspaceCreationSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => createUserWorkspace(ctx.actor, input))
    ),
  files: workspaceProcedure
    .input(
      z.object({
        path: z.optional(WorkspacePathSchema),
        revision: z.optional(GitRevisionSchema),
      })
    )
    .query(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        const result = await WorkspaceRepository.read(
          ctx.actor,
          input.path,
          input.revision
        );
        return {
          ...result,
          canEdit:
            !input.path?.startsWith("proposals/knowledge/") &&
            (ctx.actor.role !== "member" ||
              Boolean(
                input.path &&
                (input.path.startsWith("knowledge/") ||
                  input.path.startsWith("proposals/skills/") ||
                  input.path.startsWith("proposals/tools/"))
              )),
        };
      })
    ),
  history: workspaceProcedure
    .input(
      z.object({
        path: WorkspacePathSchema,
      })
    )
    .query(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        return await WorkspaceRepository.history(ctx.actor, input.path);
      })
    ),
  write: workspaceProcedure
    .input(WorkspaceWriteSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          return await WorkspaceRepository.write(ctx.actor, input);
        } catch (error) {
          if (error instanceof WorkspaceRepositoryError)
            throw new TRPCError({
              code: error.reason === "conflict" ? "CONFLICT" : "BAD_REQUEST",
              message:
                error.reason === "conflict"
                  ? "This file changed. Reload it before saving."
                  : "Unable to save this file.",
            });
          throw error;
        }
      })
    ),
  skills: {
    proposals: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => listSkillProposals(ctx.actor))
    ),
    publish: workspaceProcedure
      .input(PublishSkillProposalSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            try {
              return await publishSkillProposal(ctx.actor, input);
            } catch (error) {
              if (error instanceof WorkspaceAccessDenied)
                throw new TRPCError({
                  code: "FORBIDDEN",
                });
              throw error;
            }
          } catch (error) {
            if (error instanceof WorkspaceRepositoryError)
              throw new TRPCError({
                code: error.reason === "conflict" ? "CONFLICT" : "BAD_REQUEST",
                message:
                  error.reason === "conflict"
                    ? "This file changed. Reload it before saving."
                    : "Unable to publish this skill.",
              });
            throw error;
          }
        })
      ),
    rollback: workspaceProcedure
      .input(RollbackSkillSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            try {
              return await rollbackSkill(ctx.actor, input);
            } catch (error) {
              if (error instanceof WorkspaceAccessDenied)
                throw new TRPCError({
                  code: "FORBIDDEN",
                });
              throw error;
            }
          } catch (error) {
            if (error instanceof WorkspaceRepositoryError)
              throw new TRPCError({
                code: error.reason === "conflict" ? "CONFLICT" : "BAD_REQUEST",
                message:
                  error.reason === "conflict"
                    ? "This file changed. Reload it before saving."
                    : "Unable to restore this skill.",
              });
            throw error;
          }
        })
      ),
  },
};

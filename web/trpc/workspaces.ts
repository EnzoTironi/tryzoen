import { withSignal } from "../../server/operations/async";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { WorkspaceRepositoryError } from "../../server/workspaces/repository";
import { ScheduleChanged } from "../../server/schedules/manage";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createUserWorkspace,
  listUserWorkspaces,
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
import {
  GitRevisionSchema,
  WorkspacePathSchema,
} from "../../server/workspaces/git";
import { workspaceProcedure } from "./workspace-procedure";
import { workspaceRoomsRouter } from "./workspace-rooms";
import { workspaceToolsRouter } from "./workspace-tools";
import { workspaceAgentsRouter } from "./workspace-agents";
import { readWorkspaceCapabilities } from "../../server/workspaces/capabilities";
import {
  ReminderStatusSchema,
  setReminderStatus,
} from "../../server/schedules/manage";
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
import {
  LearnedMemory,
  LearnedMemoryWriteSchema,
} from "../../server/memory/learned";
export const workspacesRouter = {
  tools: workspaceToolsRouter,
  rooms: workspaceRoomsRouter,
  ...workspaceAgentsRouter,
  schedules: {
    setStatus: workspaceProcedure
      .input(ReminderStatusSchema)
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
    recover: workspaceProcedure.mutation(({ ctx, signal }) =>
      withSignal(signal, async () => {
        return await LearnedMemory.recover(ctx.actor);
      })
    ),
    list: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => {
        return await LearnedMemory.read(ctx.actor, undefined, true);
      })
    ),
    write: workspaceProcedure
      .input(LearnedMemoryWriteSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          return await LearnedMemory.write(ctx.actor, input, false);
        })
      ),
    setEnabled: workspaceProcedure
      .input(
        z.object({
          enabled: z.boolean(),
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          return await LearnedMemory.setEnabled(ctx.actor, input.enabled);
        })
      ),
  },
  list: workspaceProcedure.query(({ ctx, signal }) =>
    withSignal(signal, async () => listUserWorkspaces(ctx.actor))
  ),
  create: workspaceProcedure
    .input(
      z.object({
        name: z
          .string()
          .refine((value) => value === value.trim(), "Expected trimmed text")
          .min(1)
          .max(80),
      })
    )
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => createUserWorkspace(ctx.actor, input.name))
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
        return await WorkspaceRepository.read(
          ctx.actor,
          input.path,
          input.revision
        );
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

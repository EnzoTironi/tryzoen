import { withSignal } from "../../server/operations/async";
import { WhatsAppBridgeUnavailable } from "../../server/whatsapp/client";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  OntologySchema,
  OntologyActionSchema,
} from "@shared/workspaces/ontology";
import { GitRevisionSchema } from "../../server/workspaces/git";
import {
  applyOntologyAction,
  publishOntology,
  readOntology,
} from "../../server/workspaces/ontology";
import {
  AgentGrantInputSchema,
  BotProfileSchema,
  issueAgentGrant,
  readWorkspaceBot,
  revokeAgentGrant,
  saveWorkspaceBot,
  searchWorkspaceBots,
} from "../../server/workspaces/bots";
import {
  DelegateVaultItemSchema,
  delegateVaultItem,
  inspectVaultDelegations,
  listDelegatedVaultItems,
  revokeVaultDelegation,
} from "../../server/workspaces/vault";
import {
  ShareWhatsAppChatSchema,
  listWhatsAppAccounts,
  listWhatsAppChats,
  pauseWhatsAppBridge,
  resumeWhatsAppBridge,
  revokeWhatsAppBridge,
  shareWhatsAppChat,
  startWhatsAppPairing,
} from "../../server/workspaces/whatsapp";
import {
  disconnectWorkspaceGoogle,
  readWorkspaceConnections,
  shareGoogleConnection,
} from "../../server/workspaces/connections";
import {
  AnswerPersonalTrustSchema,
  PersonalTrustUsernameSchema,
  answerPersonalTrust,
  blockPersonalTrust,
  endPersonalTrust,
  invitePersonalTrust,
  listPersonalNetwork,
} from "../../server/workspaces/network";
import { workspaceProcedure } from "./workspace-procedure";
import {
  MatrixConversationInput,
  MatrixConversationSend,
  openMatrixConversation,
  listMatrixConversations,
  readMatrixConversation,
  sendMatrixConversation,
  closeMatrixConversation,
} from "../../server/matrix/conversations";
const revisionFields = {
  expectedRevision: z.nullable(GitRevisionSchema),
  operationId: z.uuid(),
};
export const workspaceAgentsRouter = {
  ontology: {
    read: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => readOntology(ctx.actor))
    ),
    publish: workspaceProcedure
      .input(
        z.object({
          ...revisionFields,
          graph: OntologySchema,
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => publishOntology(ctx.actor, input))
      ),
    act: workspaceProcedure
      .input(
        z.object({
          ...revisionFields,
          ...OntologyActionSchema.shape,
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => applyOntologyAction(ctx.actor, input))
      ),
  },
  bot: {
    read: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => readWorkspaceBot(ctx.actor))
    ),
    save: workspaceProcedure
      .input(BotProfileSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => saveWorkspaceBot(ctx.actor, input))
      ),
    search: workspaceProcedure
      .input(
        z.object({
          query: z.string().max(30),
        })
      )
      .query(({ ctx, input, signal }) =>
        withSignal(signal, async () =>
          searchWorkspaceBots(ctx.actor, input.query)
        )
      ),
    grant: workspaceProcedure
      .input(AgentGrantInputSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => issueAgentGrant(ctx.actor, input))
      ),
    revoke: workspaceProcedure
      .input(
        z.object({
          id: z.uuid(),
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => revokeAgentGrant(ctx.actor, input.id))
      ),
  },
  network: {
    conversations: {
      list: workspaceProcedure.query(({ ctx, signal }) =>
        withSignal(signal, async () => listMatrixConversations(ctx.actor))
      ),
      open: workspaceProcedure
        .input(PersonalTrustUsernameSchema)
        .mutation(({ ctx, input, signal }) =>
          withSignal(signal, async () => {
            const c = await openMatrixConversation(ctx.actor, input.username);
            return {
              id: c.id,
              name: c.name,
              username: c.username,
              network: c.networkKind,
            };
          })
        ),
      messages: workspaceProcedure
        .input(MatrixConversationInput)
        .query(({ ctx, input, signal }) =>
          withSignal(signal, async () =>
            readMatrixConversation(ctx.actor, input.id)
          )
        ),
      send: workspaceProcedure
        .input(MatrixConversationSend)
        .mutation(({ ctx, input, signal }) =>
          withSignal(signal, async () =>
            sendMatrixConversation(ctx.actor, input)
          )
        ),
      close: workspaceProcedure
        .input(MatrixConversationInput)
        .mutation(({ ctx, input, signal }) =>
          withSignal(signal, async () =>
            closeMatrixConversation(ctx.actor, input.id)
          )
        ),
    },
    list: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => {
        try {
          return await listPersonalNetwork(ctx.actor);
        } catch (error) {
          if (error instanceof WorkspaceAccessDenied)
            throw new TRPCError({
              code: "FORBIDDEN",
            });
          throw error;
        }
      })
    ),
    invite: workspaceProcedure
      .input(PersonalTrustUsernameSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            return await invitePersonalTrust(ctx.actor, input);
          } catch (error) {
            if (error instanceof WorkspaceAccessDenied)
              throw new TRPCError({
                code: "FORBIDDEN",
              });
            throw error;
          }
        })
      ),
    answer: workspaceProcedure
      .input(AnswerPersonalTrustSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            return await answerPersonalTrust(ctx.actor, input);
          } catch (error) {
            if (error instanceof WorkspaceAccessDenied)
              throw new TRPCError({
                code: "FORBIDDEN",
              });
            throw error;
          }
        })
      ),
    end: workspaceProcedure
      .input(PersonalTrustUsernameSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            return await endPersonalTrust(ctx.actor, input);
          } catch (error) {
            if (error instanceof WorkspaceAccessDenied)
              throw new TRPCError({
                code: "FORBIDDEN",
              });
            throw error;
          }
        })
      ),
    block: workspaceProcedure
      .input(PersonalTrustUsernameSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            return await blockPersonalTrust(ctx.actor, input);
          } catch (error) {
            if (error instanceof WorkspaceAccessDenied)
              throw new TRPCError({
                code: "FORBIDDEN",
              });
            throw error;
          }
        })
      ),
  },
  connections: {
    list: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => readWorkspaceConnections(ctx.actor))
    ),
    shareGoogle: workspaceProcedure.mutation(({ ctx, signal }) =>
      withSignal(signal, async () => shareGoogleConnection(ctx.actor))
    ),
    disconnectGoogle: workspaceProcedure.mutation(({ ctx, signal }) =>
      withSignal(signal, async () => disconnectWorkspaceGoogle(ctx.actor))
    ),
  },
  vault: {
    delegations: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => inspectVaultDelegations(ctx.actor))
    ),
    list: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => {
        try {
          return await listDelegatedVaultItems({
            userId: ctx.actor.userId,
            workspaceId: ctx.actor.workspaceId,
          });
        } catch (error) {
          if (error instanceof WorkspaceAccessDenied)
            throw new TRPCError({
              code: "FORBIDDEN",
            });
          throw error;
        }
      })
    ),
    delegate: workspaceProcedure
      .input(DelegateVaultItemSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            return await delegateVaultItem(ctx.actor, input);
          } catch (error) {
            if (error instanceof WorkspaceAccessDenied)
              throw new TRPCError({
                code: "FORBIDDEN",
              });
            throw error;
          }
        })
      ),
    revoke: workspaceProcedure
      .input(
        z.object({
          id: z.uuid(),
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            return await revokeVaultDelegation(ctx.actor, input.id);
          } catch (error) {
            if (error instanceof WorkspaceAccessDenied)
              throw new TRPCError({
                code: "FORBIDDEN",
              });
            throw error;
          }
        })
      ),
  },
  whatsapp: {
    list: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => {
        try {
          return {
            accounts: await listWhatsAppAccounts(ctx.actor),
            chats: await listWhatsAppChats(ctx.actor),
          };
        } catch (error) {
          if (error instanceof WorkspaceAccessDenied)
            throw new TRPCError({
              code: "FORBIDDEN",
            });
          throw error;
        }
      })
    ),
    start: workspaceProcedure.mutation(({ ctx, signal }) =>
      withSignal(signal, async () => {
        try {
          return await Promise.try(async () =>
            startWhatsAppPairing(ctx.actor)
          ).then(({ id, available, qr }) => ({
            id,
            available,
            qr,
          }));
        } catch (error) {
          if (error instanceof WorkspaceAccessDenied)
            throw new TRPCError({
              code: "FORBIDDEN",
            });
          throw error;
        }
      })
    ),
    pause: workspaceProcedure.mutation(({ ctx, signal }) =>
      withSignal(signal, async () => {
        try {
          return await pauseWhatsAppBridge(ctx.actor);
        } catch (error) {
          if (error instanceof WorkspaceAccessDenied)
            throw new TRPCError({
              code: "FORBIDDEN",
            });
          throw error;
        }
      })
    ),
    resume: workspaceProcedure.mutation(({ ctx, signal }) =>
      withSignal(signal, async () => {
        try {
          try {
            return await resumeWhatsAppBridge(ctx.actor);
          } catch (error) {
            if (error instanceof WorkspaceAccessDenied)
              throw new TRPCError({
                code: "FORBIDDEN",
              });
            throw error;
          }
        } catch (error) {
          if (error instanceof WhatsAppBridgeUnavailable)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
            });
          throw error;
        }
      })
    ),
    revoke: workspaceProcedure.mutation(({ ctx, signal }) =>
      withSignal(signal, async () => {
        try {
          return await revokeWhatsAppBridge(ctx.actor);
        } catch (error) {
          if (error instanceof WorkspaceAccessDenied)
            throw new TRPCError({
              code: "FORBIDDEN",
            });
          throw error;
        }
      })
    ),
    share: workspaceProcedure
      .input(ShareWhatsAppChatSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            return await shareWhatsAppChat(ctx.actor, input);
          } catch (error) {
            if (error instanceof WorkspaceAccessDenied)
              throw new TRPCError({
                code: "FORBIDDEN",
              });
            throw error;
          }
        })
      ),
  },
};

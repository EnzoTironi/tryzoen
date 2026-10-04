import { withSignal } from "../../server/operations/async";
import { gateway } from "ai";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { listBrowserTraces } from "@db/services/browser-traces";
import { saveChat } from "@db/services/chats";
import { replacePersonalProfile } from "../../server/personal-memory/profile";
import { selectGatewayModel } from "@db/services/settings";
import {
  listAccountVaultItems,
  readAccountVaultItem,
  updateAccountVaultItem,
  createAccountVaultItem,
  importAccountVaultItems,
  removeAccountVaultItem,
} from "../../server/workspaces/vault/items";
import { saveChatSchema } from "@shared/chat/schema";
import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import { disconnectGoogleWorkspace } from "../../server/google-workspace";
import {
  activatePersonalGoogle,
  readPersonalGoogleSettings,
} from "../../server/google-workspace/settings";
import { resolveWorkspaceActor } from "../../server/workspaces/session";
import { IdentitySchema } from "../../server/accounts";
import {
  revokeLinkedChannelIdentity,
  readLinkedChannelIdentities,
} from "../../server/accounts/controls";
import { userProfileSchema } from "@shared/user-profile/schema";
import {
  vaultPageInputSchema,
  vaultPageSchema,
} from "@zoen/companion-ui/vault";
import {
  vaultCreateItemSchema,
  vaultItemRevisionSchema,
  vaultUpdateItemSchema,
  vaultImportItemsSchema,
} from "@zoen/companion-ui/vault";
import { createTRPCRouter, protectedProcedure } from "./init";
import { workspacesRouter } from "./workspaces";
import { modelsRouter } from "./models";
import { insightsRouter } from "./insights";
import { companionRouter } from "./companion";
import { personalMemoryRouter } from "./personal-memory";
export const appRouter = createTRPCRouter({
  companion: companionRouter,
  personalMemory: personalMemoryRouter,
  modelConnections: modelsRouter,
  insights: insightsRouter,
  workspaces: workspacesRouter,
  accountChannels: {
    list: protectedProcedure.query(({ ctx }) =>
      readLinkedChannelIdentities(ctx.requestHeaders)
    ),
    revoke: protectedProcedure
      .input(
        z.object({
          identityId: IdentitySchema.shape.id,
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          try {
            return await revokeLinkedChannelIdentity(
              ctx.requestHeaders,
              input.identityId
            );
          } catch {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message:
                "Your linked channel could not be updated. Please try again.",
            });
          }
        })
      ),
  },
  chats: {
    save: protectedProcedure
      .input(saveChatSchema)
      .mutation(({ ctx, input }) => saveChat(ctx.scope, input)),
  },
  googleWorkspace: {
    read: protectedProcedure.query(async ({ ctx }) =>
      readPersonalGoogleSettings(
        await resolveWorkspaceActor(ctx.requestHeaders, "personal")
      )
    ),
    update: protectedProcedure
      .input(
        z.object({
          action: z.enum(["connect", "disconnect"]),
          returnTo: z.optional(z.string()),
        })
      )
      .mutation(async ({ ctx, input, signal }) => {
        const returnTo = googleWorkspaceReturnTo(input.returnTo);
        if (input.action === "disconnect") {
          await withSignal(signal, async () =>
            disconnectGoogleWorkspace(ctx.requestHeaders)
          );
          const query = new URLSearchParams({
            google: "disconnected",
            returnTo,
          });
          return {
            redirectTo: `/?${query}`,
            authorize: false,
          };
        }
        const activation = await withSignal(signal, async () => {
          return await Promise.try(async () =>
            resolveWorkspaceActor(ctx.requestHeaders, "personal")
          ).then(activatePersonalGoogle);
        });
        if (!activation.authorize)
          return {
            redirectTo: returnTo,
            authorize: false,
          };
        const query = new URLSearchParams({
          returnTo,
        });
        return {
          redirectTo: `/api/google-workspace/connect?${query}`,
          authorize: true,
        };
      }),
  },
  settings: {
    selectModel: protectedProcedure
      .input(
        z.object({
          modelId: z.string().trim().min(1).max(300),
        })
      )
      .mutation(({ ctx, input }) =>
        selectGatewayModel(ctx.scope, input.modelId)
      ),
  },
  userProfile: {
    update: protectedProcedure
      .input(userProfileSchema)
      .output(userProfileSchema)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () =>
          replacePersonalProfile(ctx.requestHeaders, input)
        )
      ),
  },
  traces: {
    list: protectedProcedure
      .input(
        z.object({
          cursor: z.string().nullish(),
        })
      )
      .query(({ ctx, input }) =>
        listBrowserTraces(ctx.scope, input.cursor ?? undefined)
      ),
  },
  vault: {
    list: protectedProcedure
      .input(vaultPageInputSchema)
      .output(vaultPageSchema)
      .query(({ ctx, input }) =>
        listAccountVaultItems(ctx.requestHeaders, input)
      ),
    read: protectedProcedure
      .input(vaultItemRevisionSchema)
      .output(vaultCreateItemSchema.nullable())
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, () =>
          readAccountVaultItem(ctx.requestHeaders, input)
        )
      ),
    update: protectedProcedure
      .input(vaultUpdateItemSchema)
      .output(z.boolean())
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, () =>
          updateAccountVaultItem(ctx.requestHeaders, input)
        )
      ),
    create: protectedProcedure
      .input(vaultCreateItemSchema)
      .mutation(({ ctx, input }) =>
        createAccountVaultItem(ctx.requestHeaders, input)
      ),
    import: protectedProcedure
      .input(vaultImportItemsSchema)
      .mutation(({ ctx, input }) =>
        importAccountVaultItems(ctx.requestHeaders, input)
      ),
    remove: protectedProcedure
      .input(
        z.object({
          id: z.string().min(1),
        })
      )
      .mutation(({ ctx, input }) =>
        removeAccountVaultItem(ctx.requestHeaders, input.id)
      ),
  },
  models: {
    list: protectedProcedure.query(readModelCatalog),
  },
});
export type AppRouter = typeof appRouter;
async function readModelCatalog() {
  const { models } = await gateway.getAvailableModels();
  return z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        ownedBy: z.string(),
        pricing: z
          .object({
            input: z.number().nonnegative().optional(),
            output: z.number().nonnegative().optional(),
          })
          .optional(),
      })
    )
    .parse(
      models
        .filter((model) => model.modelType === "language")
        .map((model) => ({
          id: model.id,
          name: model.name,
          ownedBy: model.specification.provider,
          pricing: model.pricing
            ? {
                input: perMillion(model.pricing.input),
                output: perMillion(model.pricing.output),
              }
            : undefined,
        }))
    );
}
function perMillion(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
}

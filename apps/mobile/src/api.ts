import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client";
import type { z } from "zod";
import {
  companionChatsSchema,
  companionFilesSchema,
} from "../../../shared/companion/schema";
import { accountHeaders } from "./auth";
import { apiOrigin } from "./environment";
export const rpc = createTRPCUntypedClient({
  links: [
    httpBatchLink({
      url: `${apiOrigin}/api/trpc`,
      headers: accountHeaders,
      fetch: (url, options) => fetch(url, { ...options, redirect: "error" }),
    }),
  ],
});
export const queries = {
  chats: async (
    query: string,
    cursor?: z.output<typeof companionChatsSchema>["nextCursor"]
  ) =>
    companionChatsSchema.parse(
      await rpc.query("companion.chats", { query, cursor })
    ),
  files: async (path?: string) =>
    companionFilesSchema.parse(await rpc.query("workspaces.files", { path })),
};

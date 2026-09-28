import { z } from "zod";
import type { Client } from "eve/client";
import type { IdeasData } from "@zoen/companion-ui";
import { ideaPageSchema } from "@zoen/companion-ui/ideas";

export function companionIdeasData(
  rpc: {
    query: (path: string, input?: unknown) => Promise<unknown>;
    mutation: (path: string, input?: unknown) => Promise<unknown>;
  },
  client: Client
): IdeasData {
  return {
    async list(cursor) {
      return ideaPageSchema.parse(
        await rpc.query("companion.ideas", { cursor })
      );
    },
    async feedback(input) {
      await rpc.mutation("companion.rateIdea", input);
    },
    async start(id) {
      const response = await client.fetch(
        `/api/companion/ideas/${encodeURIComponent(id)}/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }
      );
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "Sign in again to start this idea."
            : "Could not confirm the start. Try again to recover this task."
        );
      return z
        .object({ sessionId: z.string().min(1) })
        .parse(await response.json()).sessionId;
    },
  };
}

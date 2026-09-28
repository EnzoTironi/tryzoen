import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactionData, reactionPageSchema } from "./schema";
import type { z } from "zod";

export function useMessageReactions(
  data: ReactionData,
  cacheScope: string,
  sessionId: string
) {
  const client = useQueryClient();
  const [messageIds, setMessageIds] = useState<string[]>([]);
  const prefix = ["message-reactions", cacheScope, sessionId];
  const query = useQuery({
    queryKey: [...prefix, messageIds],
    queryFn: () => data.read({ sessionId, messageIds }),
    enabled: messageIds.length > 0,
    staleTime: 15_000,
    gcTime: 60_000,
  });
  const showMessages = useCallback((ids: string[]) => {
    const next = [...new Set(ids)].slice(0, 50);
    setMessageIds((current) =>
      current.join("\n") === next.join("\n") ? current : next
    );
  }, []);
  return {
    query,
    showMessages,
    setReaction: async (messageId: string, emoji: string | null) => {
      const saved = await data.set({ sessionId, messageId, emoji });
      await client.cancelQueries({ queryKey: prefix });
      client.setQueryData<z.infer<typeof reactionPageSchema>>(
        [...prefix, messageIds],
        (current) => [
          ...(current ?? []).filter((item) => item.messageId !== messageId),
          saved,
        ]
      );
      void client.invalidateQueries({ queryKey: prefix });
    },
  };
}

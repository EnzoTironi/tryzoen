import { useCallback, useState } from "react";
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  messageReactionSchema,
  type ReactionData,
  type reactionPageSchema,
} from "./schema";
import type { z } from "zod";

export function useMessageReactions(
  data: ReactionData,
  cacheScope: string,
  sessionId: string
) {
  const client = useQueryClient();
  const [messageIds, setMessageIds] = useState<string[]>([]);
  const prefix = ["message-reactions", cacheScope, sessionId];
  const mutationKey = [...prefix, "set"];
  const query = useQuery({
    queryKey: [...prefix, messageIds],
    queryFn: async () => {
      const saved = await data.read({ sessionId, messageIds });
      const byId = new Map(saved.map((item) => [item.messageId, item]));
      return messageIds.map(
        (messageId) => byId.get(messageId) ?? { messageId, emoji: null }
      );
    },
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
  const change = useMutation({
    mutationKey,
    scope: { id: JSON.stringify(mutationKey) },
    networkMode: "always",
    retry: false,
    mutationFn: async ({
      messageId,
      emoji,
    }: z.infer<typeof messageReactionSchema>) => {
      const saved = await data.set({ sessionId, messageId, emoji });
      await client.cancelQueries({ queryKey: prefix });
      client.setQueriesData<z.infer<typeof reactionPageSchema>>(
        { queryKey: prefix },
        (current) =>
          current?.map((item) => (item.messageId === messageId ? saved : item))
      );
      void client.invalidateQueries({ queryKey: prefix, refetchType: "none" });
    },
  });
  const pendingChanges = useMutationState({
    filters: { mutationKey, status: "pending" },
    select: (mutation) => messageReactionSchema.parse(mutation.state.variables),
  });
  const previews = new Map(
    pendingChanges.map((item) => [item.messageId, item.emoji])
  );
  return {
    query: {
      ...query,
      data: query.data?.map((item) =>
        previews.has(item.messageId)
          ? {
              messageId: item.messageId,
              emoji: previews.get(item.messageId) ?? null,
            }
          : item
      ),
    },
    showMessages,
    setReaction: (messageId: string, emoji: string | null) =>
      change.mutateAsync({ messageId, emoji }),
  };
}

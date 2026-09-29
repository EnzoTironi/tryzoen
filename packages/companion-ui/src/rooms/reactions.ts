import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  onlineManager,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import {
  roomReactionWriteSchema,
  type RoomData,
  type roomReactionsPageSchema,
} from "./schema";
import { previewReaction } from "./reaction-preview";

const changeSchema = roomReactionWriteSchema.pick({
  messageId: true,
  emoji: true,
});

export function useRoomReactions(
  data: Pick<RoomData, "reactions" | "react" | "operationId">,
  cacheScope: string,
  roomId: string,
  enabled: boolean
) {
  const client = useQueryClient();
  const scope = JSON.stringify([cacheScope, roomId]);
  const lifetime = useRef<{ scope: string; active: boolean } | undefined>(
    undefined
  );
  useEffect(() => {
    const current = { scope, active: enabled };
    lifetime.current = current;
    return () => {
      current.active = false;
    };
  }, [scope, enabled]);
  const [ids, setIds] = useState<string[]>([]);
  const pending = useRef(
    new Map<
      string,
      { emoji: string | null; operationId: string; previousEventId?: string }
    >()
  );
  const prefix = ["matrix-reactions", cacheScope, roomId];
  const mutationKey = [...prefix, "set"];
  const result = useQuery({
    queryKey: [...prefix, ids],
    queryFn: ({ signal }) =>
      data.reactions({ id: roomId, messageIds: ids }, signal),
    enabled: enabled && ids.length > 0,
    staleTime: Infinity,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
  const showMessages = useCallback((visible: string[]) => {
    const next = [...new Set(visible)].slice(0, 12);
    setIds((current) =>
      current.length === next.length && next.every((id) => current.includes(id))
        ? current
        : next
    );
  }, []);
  const setReaction = async (messageId: string, emoji: string | null) => {
    const owner = lifetime.current;
    const allowed = () =>
      owner?.active &&
      owner.scope === scope &&
      AppState.currentState === "active" &&
      onlineManager.isOnline();
    const requireActive = () => {
      if (!allowed())
        throw new Error("Return to the active conversation to react.");
    };
    requireActive();
    const cached =
      client.getQueryData<z.infer<typeof roomReactionsPageSchema>>([
        ...prefix,
        ids,
      ]) ?? result.data;
    const latest =
      result.isError || !cached
        ? await result.refetch()
        : { data: cached, isError: false };
    requireActive();
    const summary = latest.data?.find((item) => item.messageId === messageId);
    if (latest.isError || !summary)
      throw new Error("Reactions are unavailable. Try again.");
    if (!summary.complete)
      throw new Error(
        "This message has too many reactions to update safely. Try another message."
      );
    let operation = pending.current.get(messageId);
    if (!operation || operation.emoji !== emoji) {
      operation = {
        emoji,
        operationId: data.operationId(),
        previousEventId: summary.mineEventId ?? undefined,
      };
      pending.current.set(messageId, operation);
    }
    const saved = await data.react({ id: roomId, messageId, ...operation });
    pending.current.delete(messageId);
    if (!allowed()) return;
    await client.cancelQueries({ queryKey: prefix });
    if (!allowed()) return;
    client.setQueriesData<z.infer<typeof roomReactionsPageSchema>>(
      { queryKey: prefix },
      (current) =>
        current?.map((item) => (item.messageId === messageId ? saved : item))
    );
    void client.invalidateQueries({ queryKey: prefix, refetchType: "none" });
  };
  const change = useMutation({
    mutationKey,
    // Main timeline and thread share ordering, including changes queued on the same event.
    scope: { id: JSON.stringify(mutationKey) },
    networkMode: "always",
    retry: false,
    mutationFn: (input: z.infer<typeof changeSchema>) =>
      setReaction(input.messageId, input.emoji),
  });
  const pendingChanges = useMutationState({
    filters: { mutationKey, status: "pending" },
    select: (mutation) => changeSchema.parse(mutation.state.variables),
  });
  const previews = new Map(
    pendingChanges.map((item) => [item.messageId, item.emoji])
  );
  return {
    result: {
      ...result,
      data: result.data?.map((item) =>
        previews.has(item.messageId)
          ? previewReaction(item, previews.get(item.messageId) ?? null)
          : item
      ),
    },
    showMessages,
    setReaction: (messageId: string, emoji: string | null) =>
      change.mutateAsync({ messageId, emoji }),
  };
}

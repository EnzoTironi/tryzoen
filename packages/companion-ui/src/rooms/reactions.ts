import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { RoomData, roomReactionsPageSchema } from "./schema";

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
  const result = useQuery({
    queryKey: [...prefix, ids],
    queryFn: ({ signal }) =>
      data.reactions({ id: roomId, messageIds: ids }, signal),
    enabled: enabled && ids.length > 0,
    staleTime: 15_000,
    gcTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
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
    const latest =
      result.isError || !result.data ? await result.refetch() : result;
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
    void client.invalidateQueries({ queryKey: prefix });
  };
  return { result, showMessages, setReaction };
}

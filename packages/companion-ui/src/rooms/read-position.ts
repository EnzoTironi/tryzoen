import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { updateRoomUnread } from "../chats/notifications";
import { AppState } from "react-native";
import type { RoomData, roomMessageSchema } from "./schema";
import type { z } from "zod";

/** Advance receipts only after an actually visible event dwells onscreen. */
export function useRoomReadPosition(
  data: Pick<RoomData, "markRead">,
  cacheScope: string,
  roomId: string,
  messages: z.infer<typeof roomMessageSchema>[],
  enabled: boolean,
  rootId?: string
) {
  const client = useQueryClient();
  const timeline = useRef(messages);
  const visibility = useRef<{ scope: string; ids: string[] } | undefined>(
    undefined
  );
  const viewable = useRef<((ids: string[]) => void) | undefined>(undefined);
  useEffect(() => {
    timeline.current = messages;
  }, [messages]);
  useEffect(() => {
    const scope = JSON.stringify([cacheScope, roomId, rootId]);
    let active = AppState.currentState === "active";
    let candidate: string | undefined;
    let delivered: string | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let mounted = true;
    const cancel = () => {
      clearTimeout(pending);
      pending = undefined;
    };
    const schedule = () => {
      cancel();
      if (
        !enabled ||
        !active ||
        !candidate ||
        `${cacheScope}:${candidate}` === delivered
      )
        return;
      const messageId = candidate;
      pending = setTimeout(() => {
        pending = undefined;
        if (!mounted || !active || candidate !== messageId) return;
        void data
          .markRead({ id: roomId, messageId, ...(rootId ? { rootId } : {}) })
          .then(
            () => {
              if (!mounted) return;
              delivered = `${cacheScope}:${messageId}`;
              if (
                !rootId &&
                !client.isMutating({
                  mutationKey: ["matrix-unread", cacheScope, roomId],
                })
              )
                updateRoomUnread(client, cacheScope, roomId, false);
            },
            () => {
              /* A failed receipt is not acknowledged; a later visibility event can retry. */
            }
          );
      }, 750);
    };
    viewable.current = (ids) => {
      visibility.current = { scope, ids };
      let next: string | undefined;
      for (const message of timeline.current)
        if (
          ids.includes(message.id) &&
          (rootId ? message.rootId === rootId : !message.rootId)
        )
          next = message.id;
      if (candidate === next && pending !== undefined) return;
      candidate = next;
      schedule();
    };
    viewable.current(
      visibility.current?.scope === scope ? visibility.current.ids : []
    );
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
      schedule();
    });
    return () => {
      mounted = false;
      cancel();
      viewable.current = undefined;
      subscription.remove();
    };
  }, [data, cacheScope, roomId, rootId, enabled, client]);
  return useCallback((ids: string[]) => {
    viewable.current?.(ids);
  }, []);
}

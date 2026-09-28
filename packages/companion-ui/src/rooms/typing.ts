import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import { useTypingPublisher } from "./typing-publisher";
import type { RoomData } from "./schema";

/** One room owner shared by the main and thread composers. Never sends draft text. */
export function useRoomTyping(
  data: Pick<RoomData, "setTyping" | "readTyping">,
  cacheScope: string,
  roomId: string,
  enabled: boolean
) {
  const scope = JSON.stringify([cacheScope, roomId, enabled]);
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    userIds: string[];
  }>();
  const change = useTypingPublisher(data, cacheScope, roomId, enabled);
  useEffect(() => {
    let active = AppState.currentState === "active";
    let disposed = false;
    let cursor: string | undefined;
    let read: AbortController | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const allowed = () =>
      enabled && active && onlineManager.isOnline() && !disposed;
    const clear = () => {
      clearTimeout(expiry);
      setSnapshot(undefined);
    };
    const stop = () => {
      clearTimeout(pollTimer);
      read?.abort();
      read = undefined;
      cursor = undefined;
      clear();
      change(false);
    };
    const poll = async () => {
      if (!allowed() || read) return;
      const controller = new AbortController();
      read = controller;
      try {
        const result = await data.readTyping(
          { id: roomId, cursor },
          controller.signal
        );
        if (controller.signal.aborted || !allowed()) return;
        if (result.status !== "ready") throw new Error("Typing unavailable");
        cursor = result.cursor ?? undefined;
        clear();
        const remaining = Math.min(30000, result.expiresAt - Date.now());
        if (remaining > 0 && result.userIds.length) {
          setSnapshot({ scope, userIds: result.userIds });
          expiry = setTimeout(clear, remaining);
        }
        failures = 0;
      } catch {
        if (controller.signal.aborted || disposed) return;
        failures += 1;
        cursor = undefined;
        clear();
        change(false);
      } finally {
        if (read === controller) read = undefined;
        if (!controller.signal.aborted && allowed())
          pollTimer = setTimeout(
            () => void poll(),
            Math.min(60000, 2000 * 2 ** Math.min(failures, 5))
          );
      }
    };
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
      stop();
      if (allowed()) void poll();
    });
    const online = onlineManager.subscribe((connected) => {
      stop();
      if (connected && allowed()) void poll();
    });
    void poll();
    return () => {
      disposed = true;
      stop();
      subscription.remove();
      online();
    };
  }, [data, roomId, enabled, scope, change]);
  return { userIds: snapshot?.scope === scope ? snapshot.userIds : [], change };
}

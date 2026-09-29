import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import type { RoomData } from "./schema";

/** Serialize transient state changes so a delayed true is always followed by stop. */
export function useTypingPublisher(
  data: Pick<RoomData, "setTyping">,
  cacheScope: string,
  roomId: string,
  enabled: boolean
) {
  const scope = JSON.stringify([cacheScope, roomId]);
  const input = useRef<
    { scope: string; change: (typing: boolean) => void } | undefined
  >(undefined);
  useEffect(() => {
    let active = AppState.currentState === "active";
    let disposed = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let desired = false;
    let delivered = false;
    let publishing = false;
    let lastSent = 0;
    const flush = async () => {
      if (
        publishing ||
        (desired === delivered && (!desired || Date.now() - lastSent < 10000))
      )
        return;
      publishing = true;
      const value = desired;
      // A timed-out true may have reached Matrix; a later false must still be sent.
      delivered = value;
      lastSent = Date.now();
      try {
        await data.setTyping({ id: roomId, typing: value });
      } catch {
        /* The native lease expires independently; next actual input may retry. */
      } finally {
        publishing = false;
        if (desired !== value) void flush();
      }
    };
    const stop = () => {
      clearTimeout(idle);
      desired = false;
      void flush();
    };
    input.current = {
      scope,
      change: (typing) => {
        if (
          !typing ||
          !enabled ||
          !active ||
          !onlineManager.isOnline() ||
          disposed
        ) {
          stop();
          return;
        }
        desired = true;
        clearTimeout(idle);
        idle = setTimeout(stop, 8000);
        void flush();
      },
    };
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
      stop();
    });
    const online = onlineManager.subscribe(() => {
      stop();
    });
    return () => {
      disposed = true;
      stop();
      input.current = undefined;
      subscription.remove();
      online();
    };
  }, [data, scope, roomId, enabled]);
  return useCallback(
    (typing: boolean) => {
      if (input.current?.scope === scope) input.current.change(typing);
    },
    [scope]
  );
}

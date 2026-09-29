import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { onlineManager, useQueryClient } from "@tanstack/react-query";

/** One lifecycle for a room and its threads; resume always revalidates access. */
export function useRoomLifecycle(
  cacheScope: string,
  roomId: string,
  visible = true
) {
  const client = useQueryClient();
  const [active, setActive] = useState(
    visible && AppState.currentState === "active" && onlineManager.isOnline()
  );
  useEffect(() => {
    let foreground = AppState.currentState === "active";
    const pause = () => {
      for (const prefix of [
        "matrix-messages",
        "matrix-thread",
        "matrix-reactions",
      ]) {
        const queryKey = [prefix, cacheScope, roomId];
        void client.cancelQueries({ queryKey });
        void client.invalidateQueries({ queryKey, refetchType: "none" });
      }
    };
    const update = () => {
      const ready = visible && foreground && onlineManager.isOnline();
      if (!ready) pause();
      setActive(ready);
    };
    const listener = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      update();
    });
    const unsubscribe = onlineManager.subscribe(update);
    update();
    return () => {
      listener.remove();
      unsubscribe();
      pause();
    };
  }, [client, cacheScope, roomId, visible]);
  return visible && active;
}

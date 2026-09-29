import { useEffect, useState } from "react";
import { AppState } from "react-native";
import {
  onlineManager,
  useQueryClient,
  type QueryClient,
  type QueryFilters,
} from "@tanstack/react-query";
import { useTypingPublisher } from "./typing-publisher";
import { reconcileRoomHistory } from "./history";
import type { RoomData } from "./schema";

/** One native sync for room/thread changes, reactions and typing. Never sends draft text. */
export function useRoomSync(
  data: Pick<RoomData, "setTyping" | "readSync">,
  cacheScope: string,
  roomId: string,
  enabled: boolean
) {
  const client = useQueryClient();
  const scope = JSON.stringify([cacheScope, roomId, enabled]);
  const [failure, setFailure] = useState<string>();
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
    const history = ["matrix-messages", "matrix-thread"].map((kind) => ({
      queryKey: [kind, cacheScope, roomId],
    }));
    const reactions = { queryKey: ["matrix-reactions", cacheScope, roomId] };
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
      const stopped = () => controller.signal.aborted || !allowed();
      const before = new Map(
        history.flatMap((filter) =>
          client
            .getQueryCache()
            .findAll(filter)
            .map((query) => [query.queryHash, query.state.data] as const)
        )
      );
      try {
        const result = await data.readSync(
          { id: roomId, cursor },
          controller.signal
        );
        if (stopped()) return;
        if (result.status !== "ready") throw new Error("Room sync unavailable");
        const applied = await reconcileRoomViews(
          client,
          { history, reactions },
          before,
          result,
          stopped
        );
        if (!applied) return;
        cursor = result.cursor ?? undefined;
        setFailure(undefined);
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
        setFailure(scope);
        // Authorization failures reach every view, which hides stale private content.
        await revalidateRoomViews(
          client,
          [...history, reactions],
          stopped,
          false
        );
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
  }, [data, cacheScope, roomId, enabled, scope, change, client]);
  return {
    userIds: snapshot?.scope === scope ? snapshot.userIds : [],
    reconnecting: failure === scope,
    change,
  };
}

/** Reconcile all affected views before acknowledging the shared native cursor. */
async function reconcileRoomViews(
  client: QueryClient,
  filters: { history: QueryFilters[]; reactions: QueryFilters },
  before: Parameters<typeof reconcileRoomHistory>[2],
  result: Awaited<ReturnType<RoomData["readSync"]>>,
  stopped: () => boolean
) {
  const refreshReactions = result.reset || result.reactionsChanged;
  if (
    refreshReactions &&
    client
      .getQueryCache()
      .findAll(filters.reactions)
      .some((query) => query.state.fetchStatus === "fetching")
  )
    return false;
  if (result.reset || result.timelineChanged) {
    const reconciled = reconcileRoomHistory(
      client,
      filters.history.flatMap((filter) =>
        client.getQueryCache().findAll(filter)
      ),
      before,
      result.reset ? null : result.changes
    );
    if (reconciled === "retry") return false;
    if (reconciled === "recover")
      await revalidateRoomViews(client, filters.history, stopped);
    if (stopped()) return false;
  }
  if (refreshReactions)
    await revalidateRoomViews(client, [filters.reactions], stopped);
  return !stopped();
}

async function revalidateRoomViews(
  client: QueryClient,
  filters: QueryFilters[],
  stopped: () => boolean,
  throwOnError = true
) {
  if (stopped()) return;
  await Promise.all(
    filters.map((filter) =>
      client.invalidateQueries({ ...filter, refetchType: "none" })
    )
  );
  if (stopped()) return;
  await Promise.all(
    filters.map((filter) =>
      client.refetchQueries(
        { ...filter, type: "active" },
        { cancelRefetch: false, throwOnError }
      )
    )
  );
}

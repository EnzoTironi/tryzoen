import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  useQueryClient,
  onlineManager,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  InboxData,
  inboxPageSchema,
  inboxQuerySchema,
} from "./inbox-schema";
import type { z } from "zod";

/** One metadata poll for the visible inbox; message history has a separate owner. */
export function useInboxSync(
  data: InboxData,
  cacheScope: string,
  input: Omit<z.infer<typeof inboxQuerySchema>, "cursor">,
  enabled: boolean,
  nearHead: boolean,
  focusedRoomId?: string
) {
  const client = useQueryClient();
  const scope = JSON.stringify([cacheScope, input, focusedRoomId, enabled]);
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [reconnecting, setReconnecting] = useState<string | undefined>(
    undefined
  );
  const position = useRef(nearHead);
  const apply = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    position.current = nearHead;
    if (nearHead) apply.current?.();
  }, [nearHead]);
  const { query, filter, archived } = input;
  useEffect(() => {
    const lifecycle = {
      disposed: false,
      active: AppState.currentState === "active",
    };
    let cursor: string | undefined;
    let generation = 0;
    let refreshed = 0;
    const needsRefresh = () => generation !== refreshed;
    let failures = 0;
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = ["conversation-inbox", cacheScope, archived, query, filter];
    let refreshing: Promise<void> | undefined;
    const refresh = (): Promise<void> => {
      if (refreshing) return refreshing;
      if (generation === refreshed || lifecycle.disposed || !lifecycle.active)
        return Promise.resolve();
      const stopped = () => lifecycle.disposed || !lifecycle.active;
      const captured = generation;
      const run = async () => {
        await client.cancelQueries({ queryKey: key, exact: true });
        if (stopped()) return;
        client.setQueryData<InfiniteData<z.infer<typeof inboxPageSchema>>>(
          key,
          (current) =>
            current
              ? {
                  pages: current.pages.slice(0, 1),
                  pageParams: current.pageParams.slice(0, 1),
                }
              : current
        );
        await client.refetchQueries(
          { queryKey: key, exact: true, type: "active" },
          { throwOnError: true }
        );
        if (stopped()) return;
        refreshed = captured;
        if (refreshed === generation) setPending(undefined);
      };
      refreshing = run().finally(() => {
        refreshing = undefined;
      });
      return refreshing;
    };
    const applyPending = () => {
      void refresh().catch(() => {
        if (!lifecycle.disposed) setReconnecting(scope);
      });
    };
    apply.current = applyPending;
    const stop = () => {
      clearTimeout(timer);
      request?.abort();
      request = undefined;
      void client.cancelQueries({ queryKey: key, exact: true });
    };
    const poll = async () => {
      if (lifecycle.disposed || !lifecycle.active || request) return;
      const controller = new AbortController();
      request = controller;
      const stopped = () => lifecycle.disposed || controller.signal.aborted;
      const foreground = () => lifecycle.active;
      try {
        if (!enabled) {
          if (client.getQueryData(key) !== undefined) {
            generation += 1;
            await refresh();
          }
          if (!stopped()) {
            failures = 0;
            setReconnecting(undefined);
          }
          return;
        }
        const result = await data.sync(
          { query, filter, archived, cursor, focusedRoomId },
          controller.signal
        );
        if (stopped()) return;
        if (result.status === "unavailable")
          throw new Error("Sync unavailable");
        if (
          result.inboxChanged ||
          result.reset ||
          result.gapRoomIds.length > 0
        ) {
          await client.invalidateQueries({
            queryKey: ["conversation-inbox", cacheScope],
            refetchType: "none",
          });
          if (stopped()) return;
          generation += 1;
          setPending(scope);
        }
        while (needsRefresh() && position.current && !stopped())
          await refresh();
        if (stopped()) return;
        cursor = result.cursor ?? undefined;
        failures = 0;
        setReconnecting(undefined);
      } catch {
        if (stopped()) return;
        failures += 1;
        setReconnecting(scope);
      } finally {
        if (request === controller) request = undefined;
        if (!stopped() && foreground() && (enabled || failures > 0))
          timer = setTimeout(
            () => void poll(),
            Math.min(60_000, 10_000 * 2 ** Math.min(failures, 3))
          );
      }
    };
    const subscription = AppState.addEventListener("change", (state) => {
      lifecycle.active = state === "active";
      stop();
      if (lifecycle.active) {
        if (position.current) applyPending();
        void poll();
      }
    });
    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (online) {
        clearTimeout(timer);
        void poll();
      }
    });
    void poll();
    return () => {
      lifecycle.disposed = true;
      stop();
      apply.current = undefined;
      subscription.remove();
      unsubscribeOnline();
    };
  }, [
    data,
    cacheScope,
    query,
    filter,
    archived,
    focusedRoomId,
    enabled,
    client,
    scope,
  ]);
  return {
    pending: pending === scope,
    reconnecting: reconnecting === scope,
    apply: () => apply.current?.(),
  };
}

import { useEffect, useId, useMemo, useRef } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { Client } from "eve/client";
import { readOlderSessionHistory, type SessionHistoryPage } from "./history";

/** Immutable older pages; the live Eve stream remains owned by useSessionAgent. */
export function useHistoryPages(
  client: Client,
  sessionId: string,
  cacheScope: string,
  before: number | undefined
) {
  const mount = useId();
  const queryClient = useQueryClient();
  const key = useMemo(
    () => ["agent-history", cacheScope, sessionId, mount],
    [cacheScope, sessionId, mount]
  );
  const lifetime = useRef({ active: true, generation: 0 });
  const pages = useInfiniteQuery({
    queryKey: key,
    enabled: false,
    initialPageParam: before ?? 0,
    queryFn: ({ pageParam, signal }) =>
      readOlderSessionHistory(client, sessionId, pageParam, signal),
    getNextPageParam: (page: SessionHistoryPage) =>
      page.startIndex > 0 ? page.startIndex : undefined,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  useEffect(() => {
    const state = lifetime.current;
    state.active = true;
    return () => {
      state.active = false;
      state.generation += 1;
      void queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.removeQueries({ queryKey: key, exact: true });
    };
  }, [key, queryClient]);
  return {
    pending: pages.isFetching,
    error: pages.error ?? undefined,
    async load() {
      if (before === undefined || before === 0 || !lifetime.current.active)
        return undefined;
      const generation = lifetime.current.generation;
      const stopped = () =>
        !lifetime.current.active || generation !== lifetime.current.generation;
      const result = await pages.fetchNextPage({ cancelRefetch: false });
      if (stopped()) return undefined;
      if (result.error) throw result.error;
      return result.data?.pages.at(-1);
    },
  };
}

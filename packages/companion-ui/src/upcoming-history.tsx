import { useInfiniteQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { ActionButton } from "./button";
import { pageStyles } from "./page";
import type { AgentPanelData } from "./agent-content";

export interface ScheduleHistoryPage {
  readonly items: readonly {
    id: string;
    date: string;
    status: string;
    delivery: string;
    summary: string;
  }[];
  readonly nextCursor: string | null;
}

export function UpcomingHistory({
  id,
  data,
  cacheScope,
}: {
  readonly id: string;
  readonly data: AgentPanelData;
  readonly cacheScope: string;
}) {
  const history = useInfiniteQuery({
    queryKey: ["schedule-history", cacheScope, id],
    queryFn: ({ pageParam }) => data.scheduleHistory(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={pageStyles.rowTitle}>
        Run history
      </Text>
      {history.isPending && <Text style={pageStyles.copy}>Loading runs…</Text>}
      {history.error && (
        <>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            Run history couldn’t be loaded.
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              void history.refetch();
            }}
          >
            Try again
          </ActionButton>
        </>
      )}
      {history.data?.pages
        .flatMap((page) => page.items)
        .map((run) => (
          <View key={run.id} style={{ gap: 4 }}>
            <Text style={pageStyles.rowTitle}>{run.status}</Text>
            <Text style={pageStyles.copy}>{run.date}</Text>
            {Boolean(run.summary) && (
              <Text style={pageStyles.copy}>{run.summary}</Text>
            )}
            <Text style={pageStyles.copy}>Delivery: {run.delivery}</Text>
          </View>
        ))}
      {history.data?.pages[0]?.items.length === 0 && (
        <Text style={pageStyles.copy}>This task hasn’t run yet.</Text>
      )}
      {history.hasNextPage && (
        <ActionButton
          quiet
          disabled={history.isFetchingNextPage}
          onPress={() => {
            void history.fetchNextPage();
          }}
        >
          {history.isFetchingNextPage ? "Loading…" : "Earlier runs"}
        </ActionButton>
      )}
    </View>
  );
}

import { Fragment } from "react";
import { CircleCheck } from "lucide-react-native";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ActionButton } from "../button";
import { pageStyles } from "../page";
import { colors } from "../theme";
import type { GoalsData } from "./collection";

export function GoalActivity({
  data,
  id,
  revision,
  cacheScope,
}: {
  readonly data: GoalsData;
  readonly id: string;
  readonly revision: number;
  readonly cacheScope: string;
}) {
  const compact = useWindowDimensions().width < 720;
  const history = useInfiniteQuery({
    queryKey: ["goal-history", cacheScope, id, revision],
    queryFn: ({ pageParam }) => data.history(id, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.nextRevision ?? undefined,
  });
  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <View style={styles.section}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, compact && styles.compactHeading]}
      >
        Activity
      </Text>
      {history.isPending && (
        <Text style={pageStyles.copy}>Loading activity…</Text>
      )}
      {history.error && (
        <ActionButton
          quiet
          onPress={() => {
            void history.refetch();
          }}
        >
          Retry activity
        </ActionButton>
      )}
      {!history.isPending && !history.error && entries.length === 0 && (
        <Text style={pageStyles.copy}>
          Activity will appear here after the next update.
        </Text>
      )}
      {entries.map((entry, index) => {
        const day = new Date(entry.date).toDateString();
        const prior = entries[index - 1];
        const newDay = !prior || new Date(prior.date).toDateString() !== day;
        return (
          <Fragment key={entry.revision}>
            {newDay && (
              <Text style={styles.day}>
                {day === new Date().toDateString()
                  ? "TODAY"
                  : new Date(entry.date)
                      .toLocaleDateString(undefined, {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                      .toUpperCase()}
              </Text>
            )}
            <View style={styles.entry}>
              <View style={styles.track}>
                <CircleCheck
                  size={compact ? 14 : 18}
                  strokeWidth={1.5}
                  color="#008000"
                />
                {index < entries.length - 1 && <View style={styles.line} />}
              </View>
              <View style={styles.copy}>
                <Text style={[styles.title, compact && styles.compactCopy]}>
                  {entry.title}
                </Text>
                <Text style={[styles.summary, compact && styles.compactCopy]}>
                  {entry.summary}
                </Text>
              </View>
            </View>
          </Fragment>
        );
      })}
      {history.hasNextPage && (
        <ActionButton
          quiet
          disabled={history.isFetchingNextPage}
          onPress={() => {
            void history.fetchNextPage();
          }}
        >
          Show earlier updates
        </ActionButton>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8 },
  heading: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 24,
  },
  day: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 24,
    marginTop: 4,
  },
  entry: { flexDirection: "row", gap: 16 },
  track: { width: 20, alignItems: "center", paddingTop: 4 },
  line: {
    width: 1,
    flex: 1,
    marginTop: 8,
    marginBottom: 8,
    borderLeftWidth: 1,
    borderColor: colors.line,
    borderStyle: "dotted",
  },
  copy: { flex: 1, paddingBottom: 24, gap: 4 },
  title: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
  },
  summary: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  compactHeading: { fontSize: 18 },
  compactCopy: { fontSize: 14, lineHeight: 19 },
});

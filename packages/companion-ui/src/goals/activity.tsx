import { useI18n } from "./../i18n";
import { useMemo, Fragment } from "react";
import { CircleCheck } from "lucide-react-native";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import { systemFont, useColors } from "../theme";
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
  const { t, locale } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
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
        {t("Activity")}
      </Text>
      {history.isPending && (
        <Text style={pageStyles.copy}>{t("Loading activity…")}</Text>
      )}
      {history.error && (
        <ActionButton
          quiet
          onPress={() => {
            void history.refetch();
          }}
        >
          {t("Retry activity")}
        </ActionButton>
      )}
      {!history.isPending && !history.error && entries.length === 0 && (
        <Text style={pageStyles.copy}>
          {t("Activity will appear here after the next update.")}
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
                  ? t("TODAY")
                  : new Date(entry.date)
                      .toLocaleDateString(locale, {
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
          {t("Show earlier updates")}
        </ActionButton>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    section: { marginTop: 8 },
    heading: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 20,
      fontWeight: "600",
      marginBottom: 24,
    },
    day: {
      fontFamily: systemFont,
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
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 15,
      lineHeight: 21,
      fontWeight: "600",
    },
    summary: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 15,
      lineHeight: 21,
    },
    compactHeading: { fontFamily: systemFont, fontSize: 18 },
    compactCopy: { fontFamily: systemFont, fontSize: 14, lineHeight: 19 },
  });
}

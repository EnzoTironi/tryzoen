import { useI18n } from "./../../i18n";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { z } from "zod";
import type { OntologyReadSchema } from "./schema";
import type { OntologyData } from "./collection";
import { ActionButton } from "../../button";
import { usePageStyles } from "../../page";
import { useColors } from "../../theme";

export function OntologyVersions({
  data,
  revision,
  hasTime,
  disabled,
  onSelect,
}: {
  readonly data: OntologyData;
  readonly revision: z.output<typeof OntologyReadSchema>["revision"];
  readonly hasTime: boolean;
  readonly disabled: boolean;
  readonly onSelect: (
    value: z.output<typeof OntologyReadSchema>["revision"]
  ) => void;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const history = useQuery({
    queryKey: [...data.cacheKey, "history"],
    queryFn: data.history,
    staleTime: 15_000,
  });
  const entries = history.isError ? undefined : history.data;
  const current = revision === undefined && !hasTime;
  return (
    <View>
      <Text accessibilityRole="header" style={pageStyles.rowTitle}>
        {t("Recorded versions")}
      </Text>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={t("Current knowledge")}
        accessibilityState={{ checked: current }}
        disabled={disabled}
        onPress={() => {
          onSelect(undefined);
        }}
        style={styles.version}
      >
        <Clock size={20} color={colors.muted} />
        <Text style={[pageStyles.rowTitle, styles.title]}>
          {t("Current knowledge")}
        </Text>
        {current && <Check size={20} color={colors.ink} />}
      </Pressable>
      {history.isPending && (
        <Text style={pageStyles.copy}>{t("Loading recorded versions…")}</Text>
      )}
      {history.isError && (
        <View style={styles.detail}>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            {t(
              "Recorded versions could not be loaded. Your access may have changed."
            )}
          </Text>
          <ActionButton quiet onPress={() => void history.refetch()}>
            {t("Try history again")}
          </ActionButton>
        </View>
      )}
      {entries?.map((entry) => (
        <Pressable
          key={entry.revision}
          accessibilityRole="radio"
          accessibilityLabel={t("Recorded version {value1}", {
            value1: entry.revision.slice(0, 8),
          })}
          accessibilityState={{ checked: entry.revision === revision }}
          disabled={disabled}
          onPress={() => {
            onSelect(entry.revision);
          }}
          style={styles.version}
        >
          <View style={[styles.detail, styles.title]}>
            <Text style={pageStyles.rowTitle}>{entry.date}</Text>
            <Text style={pageStyles.copy}>
              {entry.source === "knowledge-publication"
                ? t("Reviewed change")
                : t("Record update")}
              {" · "}
              {entry.revision.slice(0, 8)}
            </Text>
          </View>
          {entry.revision === revision && (
            <Check size={20} color={colors.ink} />
          )}
        </Pressable>
      ))}
      {entries?.length === 0 && (
        <Text style={pageStyles.copy}>
          {t("History begins with the first published records.")}
        </Text>
      )}
      {entries?.length === 50 && (
        <Text style={pageStyles.copy}>
          {t("Showing the 50 most recent recorded versions.")}
        </Text>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    version: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: 52,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    detail: { gap: 5 },
    title: { flex: 1 },
  });
}

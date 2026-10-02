import { useI18n, Translated } from "./../../i18n";

import { useMemo, useState } from "react";
import type { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  OntologyClaimSchema,
  OntologyReadResultSchema,
  OntologySourceSchema,
} from "./schema";
import type { OntologyData } from "./collection";
import { ActionButton } from "../../button";
import { usePageStyles } from "../../page";
import { systemFont, useColors } from "../../theme";

export function OntologyEvidence({
  claim,
  record,
  data,
}: {
  readonly claim: Pick<
    z.output<typeof OntologyClaimSchema>,
    "sources" | "validTime"
  >;
  readonly record: z.output<typeof OntologyReadResultSchema>;
  readonly data: OntologyData;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const [selected, setSelected] =
    useState<z.output<typeof OntologySourceSchema>>();
  const source = useQuery({
    queryKey: [...data.cacheKey, "source", selected?.path, selected?.revision],
    queryFn: () => (selected ? data.source(selected) : null),
    enabled: !!selected,
    staleTime: 15_000,
  });
  return (
    <View style={styles.evidence}>
      <Text style={pageStyles.copy}>
        {claim.validTime
          ? t("Valid from {value1} · Until {value2} (exclusive)", {
              value1: claim.validTime.from ?? t("an unknown start"),
              value2: claim.validTime.until ?? t("an unknown end"),
            })
          : t("World-valid dates not established")}
      </Text>
      {!claim.sources.length && (
        <Text style={pageStyles.copy}>{t("No cited evidence")}</Text>
      )}
      {claim.sources.map((citation) => {
        const status = record.sources.find(
          (item) =>
            item.path === citation.path &&
            item.revision === citation.revision &&
            item.excerpt === citation.excerpt
        )?.status;
        return (
          <View key={JSON.stringify(citation)} style={styles.citation}>
            <Text selectable style={styles.passage}>
              {citation.excerpt}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Open source {value1}", {
                value1: citation.path,
              })}
              onPress={() => {
                setSelected(citation);
              }}
              style={styles.source}
            >
              <FileText size={18} color={colors.muted} />
              <Text style={[pageStyles.copy, styles.filename]}>
                {citation.path.replace(/^knowledge\//u, "")} ·{" "}
                {citation.revision.slice(0, 8)}
              </Text>
            </Pressable>
            {status !== "passage-present" && (
              <Text style={styles.warning}>
                {status === "passage-changed"
                  ? t("This passage changed in the current source.")
                  : t("The current source is unavailable.")}
              </Text>
            )}
          </View>
        );
      })}
      {selected && source.isPending && (
        <Text style={pageStyles.copy}>{t("Opening the recorded source…")}</Text>
      )}
      {selected && source.isError && (
        <View style={styles.evidence}>
          <Text accessibilityRole="alert" style={styles.warning}>
            {t(
              "This source could not be opened. It may no longer be available to you."
            )}
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              void source.refetch();
            }}
          >
            {t("Try again")}
          </ActionButton>
        </View>
      )}
      {selected && source.isSuccess && (
        <View style={styles.original}>
          <Text style={pageStyles.copy}>
            <Translated
              message="Recorded source · {value1}"
              values={{ value1: selected.revision.slice(0, 8) }}
            />
          </Text>
          <Text selectable style={styles.passage}>
            {source.data ?? t("This file was absent at the recorded revision.")}
          </Text>
        </View>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    evidence: { gap: 10 },
    citation: {
      borderLeftWidth: 2,
      borderColor: colors.line,
      paddingLeft: 12,
      gap: 4,
    },
    passage: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 15,
      lineHeight: 23,
    },
    source: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 44,
      gap: 8,
    },
    filename: { flex: 1 },
    warning: {
      fontFamily: systemFont,
      color: colors.danger,
      fontSize: 13,
      lineHeight: 19,
    },
    original: {
      padding: 14,
      borderRadius: 14,
      backgroundColor: colors.surface,
      gap: 8,
    },
  });
}

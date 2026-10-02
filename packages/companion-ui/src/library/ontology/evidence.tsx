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
          ? `Valid from ${claim.validTime.from ?? "an unknown start"} · Until ${claim.validTime.until ?? "an unknown end"} (exclusive)`
          : "World-valid dates not established"}
      </Text>
      {!claim.sources.length && (
        <Text style={pageStyles.copy}>No cited evidence</Text>
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
              accessibilityLabel={`Open source ${citation.path}`}
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
                  ? "This passage changed in the current source."
                  : "The current source is unavailable."}
              </Text>
            )}
          </View>
        );
      })}
      {selected && source.isPending && (
        <Text style={pageStyles.copy}>Opening the recorded source…</Text>
      )}
      {selected && source.isError && (
        <View style={styles.evidence}>
          <Text accessibilityRole="alert" style={styles.warning}>
            This source could not be opened. It may no longer be available to
            you.
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              void source.refetch();
            }}
          >
            Try again
          </ActionButton>
        </View>
      )}
      {selected && source.isSuccess && (
        <View style={styles.original}>
          <Text style={pageStyles.copy}>
            Recorded source · {selected.revision.slice(0, 8)}
          </Text>
          <Text selectable style={styles.passage}>
            {source.data ?? "This file was absent at the recorded revision."}
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

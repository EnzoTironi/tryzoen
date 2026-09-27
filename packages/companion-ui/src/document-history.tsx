import { useState } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ActionButton } from "./button";
import { pageStyles } from "./page";
import { colors } from "./theme";

export interface DocumentHistoryData {
  readonly cacheKey: readonly string[];
  readonly list: () => Promise<
    readonly {
      revision: string;
      date: string;
      source: string;
    }[]
  >;
  readonly read: (revision: string) => Promise<string | null>;
}

export function DocumentHistory({
  data,
  readOnly,
  onRestore,
}: {
  readonly data: DocumentHistoryData;
  readonly readOnly: boolean;
  readonly onRestore: (text: string) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const history = useQuery({
    queryKey: [...data.cacheKey, "history"],
    queryFn: data.list,
  });
  const previous = useQuery({
    queryKey: [...data.cacheKey, "revision", selected],
    queryFn: selected ? () => data.read(selected) : skipToken,
    enabled: Boolean(selected),
  });
  return (
    <View style={styles.surface}>
      <Text accessibilityRole="header" style={pageStyles.rowTitle}>
        Version history
      </Text>
      {history.isPending && (
        <Text style={pageStyles.copy}>Loading versions…</Text>
      )}
      {history.isError && (
        <ActionButton
          quiet
          onPress={() => {
            void history.refetch();
          }}
        >
          Retry history
        </ActionButton>
      )}
      {history.data?.length === 0 && (
        <Text style={pageStyles.copy}>History begins when you save.</Text>
      )}
      <ScrollView style={styles.versions}>
        {history.data?.map((entry) => (
          <Pressable
            key={entry.revision}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === entry.revision }}
            onPress={() => {
              setSelected(entry.revision);
            }}
            style={[
              styles.version,
              selected === entry.revision && styles.selected,
            ]}
          >
            <Text style={pageStyles.copy}>
              {entry.date} · {entry.source}
            </Text>
            <Text style={styles.caption}>{entry.revision.slice(0, 7)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {selected && (
        <View style={styles.preview}>
          {previous.isPending ? (
            <Text style={pageStyles.copy}>Loading version…</Text>
          ) : previous.isError ? (
            <ActionButton
              quiet
              onPress={() => {
                void previous.refetch();
              }}
            >
              Retry version
            </ActionButton>
          ) : (
            <>
              <ScrollView style={styles.source}>
                <Text selectable style={pageStyles.copy}>
                  {previous.data ?? "This version removed the file."}
                </Text>
              </ScrollView>
              {!readOnly && typeof previous.data === "string" && (
                <ActionButton
                  quiet
                  onPress={() => {
                    if (typeof previous.data === "string")
                      onRestore(previous.data);
                  }}
                >
                  Replace draft with this version
                </ActionButton>
              )}
              <Text style={styles.caption}>
                Restoring changes your draft. Save to publish the restored
                version.
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { color: colors.muted, fontSize: 12 },
  surface: {
    padding: 16,
    gap: 8,
    backgroundColor: colors.wash,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  versions: { maxHeight: 130 },
  version: { padding: 10, borderRadius: 10, gap: 4 },
  selected: { backgroundColor: colors.canvas },
  preview: { gap: 8 },
  source: { maxHeight: 140 },
});

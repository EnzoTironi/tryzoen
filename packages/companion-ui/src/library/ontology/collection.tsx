import { useState } from "react";
import type { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Network } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  OntologyReadResultSchema,
  OntologyReadSchema,
  OntologySourceSchema,
} from "./schema";
import { OntologyDossier } from "./dossier";
import { ActionButton } from "../../button";
import { pageStyles } from "../../page";
import { colors } from "../../theme";

export interface OntologyData {
  readonly cacheKey: readonly unknown[];
  readonly read: (
    input: z.output<typeof OntologyReadSchema>
  ) => Promise<z.output<typeof OntologyReadResultSchema>>;
  readonly source: (
    citation: z.output<typeof OntologySourceSchema>
  ) => Promise<string | null>;
}

export function OntologyCollection({
  data,
  query,
}: {
  readonly data: OntologyData;
  readonly query: string;
}) {
  const [selected, setSelected] = useState<string>();
  const knowledge = useQuery({
    queryKey: [...data.cacheKey, "current"],
    queryFn: () => data.read({}),
    staleTime: 15_000,
  });
  const graph = knowledge.isError ? undefined : knowledge.data?.graph;
  const term = query.toLocaleLowerCase().trim();
  const matching =
    graph?.entities.filter((entity) =>
      `${entity.name} ${graph.types.find((type) => type.id === entity.type)?.name ?? ""} ${Object.values(
        entity.properties
      )
        .map((claim) => claim.value)
        .join(" ")}`
        .toLocaleLowerCase()
        .includes(term)
    ) ?? [];
  const entity = graph?.entities.find((item) => item.id === selected);
  return (
    <View style={styles.collection}>
      <Text style={pageStyles.copy}>
        Useful facts, the people and projects they connect, and the evidence
        behind them.
      </Text>
      {knowledge.isPending && (
        <Text style={pageStyles.copy}>Loading knowledge…</Text>
      )}
      {knowledge.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          Knowledge could not be loaded. Your access may have changed.
        </Text>
      )}
      {knowledge.isError && (
        <ActionButton
          quiet
          onPress={() => {
            void knowledge.refetch();
          }}
        >
          Try again
        </ActionButton>
      )}
      {matching.slice(0, 100).map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.name}`}
          onPress={() => {
            setSelected(item.id);
          }}
          style={styles.row}
        >
          <View style={styles.icon}>
            <Network size={22} color={colors.muted} />
          </View>
          <View style={pageStyles.rowCopy}>
            <Text style={pageStyles.rowTitle}>{item.name}</Text>
            <Text style={pageStyles.copy}>
              {graph?.types.find((type) => type.id === item.type)?.name ??
                item.type}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.muted} />
        </Pressable>
      ))}
      {matching.length > 100 && (
        <Text style={pageStyles.copy}>
          Showing 100 records. Search to find a more specific person, project or
          fact.
        </Text>
      )}
      {knowledge.isSuccess && !matching.length && (
        <Text style={pageStyles.copy}>
          {term
            ? "No matching knowledge."
            : "Your published knowledge will appear here with its relationships and sources."}
        </Text>
      )}
      {entity && knowledge.data && (
        <OntologyDossier
          key={entity.id}
          entity={entity}
          record={knowledge.data}
          data={data}
          onSelect={setSelected}
          onClose={() => {
            setSelected(undefined);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  collection: { gap: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.wash,
  },
});

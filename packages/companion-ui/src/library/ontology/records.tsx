import type { z } from "zod";
import { ChevronRight, Network } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { OntologyReadResultSchema } from "./schema";
import { pageStyles } from "../../page";
import { colors } from "../../theme";

export function OntologyRecords({
  graph,
  query,
  onOpen,
}: {
  readonly graph: z.output<typeof OntologyReadResultSchema>["graph"];
  readonly query: string;
  readonly onOpen: (id: string) => void;
}) {
  const term = query.toLocaleLowerCase().trim();
  const matching = graph.entities.filter((entity) =>
    `${entity.name} ${graph.types.find((type) => type.id === entity.type)?.name ?? ""} ${Object.values(
      entity.properties
    )
      .map((claim) => claim.value)
      .join(" ")}`
      .toLocaleLowerCase()
      .includes(term)
  );
  return (
    <View>
      {matching.slice(0, 100).map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.name}`}
          onPress={() => {
            onOpen(item.id);
          }}
          style={styles.row}
        >
          <View style={styles.icon}>
            <Network size={22} color={colors.muted} />
          </View>
          <View style={pageStyles.rowCopy}>
            <Text style={pageStyles.rowTitle}>{item.name}</Text>
            <Text style={pageStyles.copy}>
              {graph.types.find((type) => type.id === item.type)?.name ??
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
      {!matching.length && (
        <Text style={pageStyles.copy}>
          {term
            ? "No matching knowledge."
            : "Your published knowledge will appear here with its relationships and sources."}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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

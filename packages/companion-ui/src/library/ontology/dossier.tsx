import type { z } from "zod";
import { ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { OntologyReadResultSchema } from "./schema";
import type { OntologyData } from "./collection";
import { OntologyEvidence } from "./evidence";
import { CompanionSheet } from "../../sheet";
import { pageStyles } from "../../page";
import { colors } from "../../theme";

export function OntologyDossier({
  entity,
  record,
  data,
  onSelect,
  onClose,
}: {
  readonly entity: z.output<
    typeof OntologyReadResultSchema
  >["graph"]["entities"][number];
  readonly record: z.output<typeof OntologyReadResultSchema>;
  readonly data: OntologyData;
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
}) {
  const type = record.graph.types.find((item) => item.id === entity.type);
  const links = record.graph.links.filter(
    (link) => link.from === entity.id || link.to === entity.id
  );
  return (
    <CompanionSheet title={entity.name} onClose={onClose}>
      <View style={styles.content}>
        <Text style={pageStyles.copy}>
          {type?.name ?? entity.type} · Recorded version{" "}
          {record.revision?.slice(0, 8) ?? "—"}
        </Text>
        {entity.sources.length > 0 && (
          <View style={styles.card}>
            <Text style={pageStyles.rowTitle}>About this record</Text>
            <OntologyEvidence
              claim={{ sources: entity.sources, validTime: null }}
              record={record}
              data={data}
            />
          </View>
        )}
        {Object.entries(entity.properties).map(([key, claim]) => (
          <View key={key} style={styles.card}>
            <Text style={pageStyles.copy}>
              {type?.properties.find((property) => property.id === key)?.name ??
                key}
            </Text>
            <Text selectable style={pageStyles.rowTitle}>
              {claim.value === null ? "Not established" : String(claim.value)}
            </Text>
            <OntologyEvidence claim={claim} record={record} data={data} />
          </View>
        ))}
        {links.length > 0 && (
          <Text accessibilityRole="header" style={pageStyles.heading}>
            Connections
          </Text>
        )}
        {links.map((link) => {
          const other = record.graph.entities.find(
            (item) =>
              item.id === (link.from === entity.id ? link.to : link.from)
          );
          if (!other) return null;
          return (
            <View
              key={JSON.stringify([link.type, link.from, link.to])}
              style={styles.card}
            >
              <Text style={pageStyles.copy}>
                {record.graph.relations.find(
                  (relation) => relation.id === link.type
                )?.name ?? link.type}{" "}
                ·{" "}
                {link.from === entity.id
                  ? "From this record"
                  : "To this record"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${other.name}`}
                onPress={() => {
                  onSelect(other.id);
                }}
                style={styles.connection}
              >
                <Text style={[pageStyles.rowTitle, styles.name]}>
                  {other.name}
                </Text>
                <ChevronRight size={18} color={colors.muted} />
              </Pressable>
              <OntologyEvidence claim={link} record={record} data={data} />
            </View>
          );
        })}
        {!Object.keys(entity.properties).length &&
          !links.length &&
          !entity.sources.length && (
            <Text style={pageStyles.copy}>
              No fields or evidence have been established for this record yet.
            </Text>
          )}
      </View>
    </CompanionSheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18 },
  card: {
    gap: 10,
    backgroundColor: colors.wash,
    borderRadius: 20,
    padding: 20,
  },
  connection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
  },
  name: { flex: 1 },
});

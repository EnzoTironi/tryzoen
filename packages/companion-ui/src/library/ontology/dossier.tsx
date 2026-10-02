import { useI18n, Translated } from "./../../i18n";

import { useMemo } from "react";
import type { z } from "zod";
import { ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { OntologyReadResultSchema } from "./schema";
import type { OntologyData } from "./collection";
import { OntologyEvidence } from "./evidence";
import { CompanionSheet } from "../../sheet";
import { usePageStyles } from "../../page";
import { useColors } from "../../theme";
import { ActionButton } from "../../button";

export function OntologyDossier({
  entity,
  record,
  data,
  onSelect,
  onClose,
  onAction,
}: {
  readonly entity: z.output<
    typeof OntologyReadResultSchema
  >["graph"]["entities"][number];
  readonly record: z.output<typeof OntologyReadResultSchema>;
  readonly data: OntologyData;
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
  readonly onAction: (actionId: string) => void;
}) {
  const { t, locale } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const type = record.graph.types.find((item) => item.id === entity.type);
  const links = record.graph.links.filter(
    (link) => link.from === entity.id || link.to === entity.id
  );
  return (
    <CompanionSheet title={entity.name} onClose={onClose}>
      <View style={styles.content}>
        <Text style={pageStyles.copy}>
          <Translated
            message="{value1} · Recorded version {value2}"
            values={{
              value1: type?.name ?? entity.type,
              value2: record.revision?.slice(0, 8) ?? "—",
            }}
          />
        </Text>
        {record.asOf && (
          <Text style={pageStyles.copy}>
            <Translated
              message="Recorded by {value1}."
              values={{ value1: new Date(record.asOf).toLocaleString(locale) }}
            />
          </Text>
        )}
        {record.validOn && (
          <Text style={pageStyles.copy}>
            <Translated
              message="Facts valid on {value1}. Unknown validity remains visible."
              values={{ value1: record.validOn }}
            />
          </Text>
        )}
        {entity.sources.length > 0 && (
          <View style={styles.card}>
            <Text style={pageStyles.rowTitle}>{t("About this record")}</Text>
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
              {claim.value === null
                ? t("Not established")
                : String(claim.value)}
            </Text>
            <OntologyEvidence claim={claim} record={record} data={data} />
          </View>
        ))}
        {record.mayManage &&
          record.asOf === null &&
          record.validOn === null &&
          record.graph.actions
            .filter((action) => action.entityType === entity.type)
            .map((action) => (
              <ActionButton
                key={action.id}
                quiet
                onPress={() => {
                  onAction(action.id);
                }}
              >
                {action.name}
              </ActionButton>
            ))}
        {links.length > 0 && (
          <Text accessibilityRole="header" style={pageStyles.heading}>
            {t("Connections")}
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
                  ? t("From this record")
                  : t("To this record")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Open {value1}", { value1: other.name })}
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
              {t(
                "No fields or evidence have been established for this record yet."
              )}
            </Text>
          )}
      </View>
    </CompanionSheet>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
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
}

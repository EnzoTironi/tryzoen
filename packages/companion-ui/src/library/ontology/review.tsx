import { useI18n } from "./../../i18n";
import { useMemo, useState } from "react";
import type { z } from "zod";
import { StyleSheet, Text, View } from "react-native";
import { OntologySchema, type OntologyClaimSchema } from "./schema";
import { ActionButton } from "../../button";
import { systemFont, useColors } from "../../theme";
import { usePageStyles } from "../../page";

/** A file proposal is rendered from its canonical graph, never a second model. */
export function OntologyReview({ content }: { readonly content: string }) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const [limit, setLimit] = useState(25);
  let graph: z.output<typeof OntologySchema>;
  try {
    graph = OntologySchema.parse(JSON.parse(content));
  } catch {
    return (
      <Text accessibilityRole="alert" style={pageStyles.copy}>
        {t("This ontology document cannot be previewed.")}
      </Text>
    );
  }
  const names = new Map(
    graph.entities.map((entity) => [entity.id, entity.name])
  );
  const total = Math.max(graph.entities.length, graph.links.length);
  return (
    <View style={styles.content}>
      <Text style={pageStyles.copy}>
        {graph.entities.length}{" "}
        {graph.entities.length === 1 ? t("record") : t("records")} ·{" "}
        {graph.links.length}{" "}
        {graph.links.length === 1 ? t("connection") : t("connections")}
      </Text>
      {graph.entities.slice(0, limit).map((entity) => (
        <View key={entity.id} style={styles.card}>
          <Text style={pageStyles.rowTitle}>{entity.name}</Text>
          <Text style={pageStyles.copy}>
            {graph.types.find((type) => type.id === entity.type)?.name ??
              entity.type}
            {" · "}
            {entity.id}
          </Text>
          {entity.sources.length > 0 && (
            <OntologyReviewClaim
              claim={{ sources: entity.sources, validTime: null }}
            />
          )}
          {Object.entries(entity.properties).map(([key, claim]) => (
            <View key={key} style={styles.content}>
              <Text selectable style={pageStyles.copy}>
                {graph.types
                  .find((type) => type.id === entity.type)
                  ?.properties.find((property) => property.id === key)?.name ??
                  key}
                {": "}
                {claim.value === null
                  ? t("Not established")
                  : String(claim.value)}
              </Text>
              <OntologyReviewClaim claim={claim} />
            </View>
          ))}
        </View>
      ))}
      {graph.links.slice(0, limit).map((link) => (
        <View
          key={JSON.stringify([link.type, link.from, link.to])}
          style={styles.card}
        >
          <Text style={pageStyles.rowTitle}>
            {names.get(link.from) ?? link.from} →{" "}
            {names.get(link.to) ?? link.to}
          </Text>
          <Text style={pageStyles.copy}>
            {graph.relations.find((relation) => relation.id === link.type)
              ?.name ?? link.type}
          </Text>
          <OntologyReviewClaim claim={link} />
        </View>
      ))}
      {total > limit && (
        <ActionButton
          quiet
          onPress={() => {
            setLimit(limit + 25);
          }}
        >
          {t("Show more records and connections")}
        </ActionButton>
      )}
      <Text style={pageStyles.rowTitle}>{t("Definitions")}</Text>
      {graph.types.map((type) => (
        <View key={type.id} style={styles.content}>
          <Text style={pageStyles.copy}>
            {type.name} · {type.id}
          </Text>
          {type.properties.map((property) => (
            <Text key={property.id} style={pageStyles.copy}>
              {property.name} · {property.id} · {property.type}
              {property.required ? t(" · Required") : ""}
            </Text>
          ))}
        </View>
      ))}
      {graph.relations.map((relation) => (
        <Text key={relation.id} style={pageStyles.copy}>
          {relation.name} · {relation.id} · {relation.from} → {relation.to}
        </Text>
      ))}
      {graph.actions.map((action) => (
        <Text key={action.id} style={pageStyles.copy}>
          {action.name} · {action.id} · {action.entityType}.{action.property}
        </Text>
      ))}
    </View>
  );
}

function OntologyReviewClaim({
  claim,
}: {
  readonly claim: Pick<
    z.output<typeof OntologyClaimSchema>,
    "sources" | "validTime"
  >;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  return (
    <View style={styles.content}>
      <Text style={styles.detail}>
        {claim.validTime
          ? t("Valid from {value1} · Until {value2} (exclusive)", {
              value1: claim.validTime.from ?? t("an unknown start"),
              value2: claim.validTime.until ?? t("an unknown end"),
            })
          : t("World-valid dates not established")}
      </Text>
      {claim.sources.map((source) => (
        <View key={JSON.stringify(source)} style={styles.citation}>
          <Text selectable style={pageStyles.copy}>
            {source.excerpt}
          </Text>
          <Text style={styles.detail}>
            {source.path} · {source.revision.slice(0, 8)}
          </Text>
        </View>
      ))}
      {!claim.sources.length && (
        <Text style={styles.detail}>{t("No cited evidence")}</Text>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    content: { gap: 8 },
    card: {
      padding: 14,
      borderRadius: 14,
      backgroundColor: colors.surface,
      gap: 10,
    },
    detail: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 12,
      lineHeight: 18,
    },
    citation: {
      borderLeftWidth: 2,
      borderColor: colors.line,
      paddingLeft: 10,
      gap: 4,
    },
  });
}

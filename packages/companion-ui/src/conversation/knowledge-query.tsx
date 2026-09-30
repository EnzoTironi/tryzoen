import { useMemo, useState } from "react";
import type { EveDynamicToolPart } from "eve/react";
import { ChartColumn } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SemanticQueryResultSchema } from "../library/semantic/schema";
import { CompanionSheet } from "../sheet";
import { ResourceCard } from "../cards/resource";
import { ActionButton } from "../button";
import { systemFont, useColors } from "../theme";
import { usePageStyles } from "../page";

export function KnowledgeQueryCard({
  part,
}: {
  readonly part: EveDynamicToolPart;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const [visible, setVisible] = useState(20);
  const parsed =
    part.state === "output-available"
      ? SemanticQueryResultSchema.safeParse(part.output)
      : null;
  const result = parsed?.success ? parsed.data : null;
  const title = result
    ? (result.manifest.query
        .split("/")
        .at(-1)
        ?.replace(/\.json$/u, "") ?? "Análise")
    : "Análise";
  const columns = result
    ? [...new Set(result.rows.flatMap((row) => Object.keys(row)))]
    : [];
  return (
    <>
      <Pressable
        style={styles.resource}
        accessibilityRole="button"
        accessibilityLabel={`Abrir análise ${title}`}
        disabled={!result}
        onPress={() => {
          setOpen(true);
        }}
      >
        <ResourceCard
          title={title}
          icon={ChartColumn}
          tint={colors.accent}
          detail={
            result
              ? `${result.rows.length} ${result.rows.length === 1 ? "linha" : "linhas"} · calculado`
              : part.state === "output-error"
                ? "Não foi possível concluir a análise"
                : part.state === "output-denied"
                  ? "Não autorizado"
                  : part.state === "output-available"
                    ? "Resultado indisponível"
                    : "Calculando…"
          }
        />
      </Pressable>
      {open && result && (
        <CompanionSheet
          title={title}
          onClose={() => {
            setOpen(false);
          }}
        >
          <View style={styles.content}>
            <Text style={pageStyles.copy}>
              Calculado sobre arquivos publicados. A atualização dos dados na
              origem não foi verificada.
            </Text>
            {!result.rows.length ? (
              <Text style={pageStyles.copy}>
                Nenhum resultado para estes argumentos.
              </Text>
            ) : (
              <ScrollView horizontal accessibilityLabel="Resultados da análise">
                <View>
                  <View style={styles.row}>
                    {columns.map((column) => (
                      <Text key={column} style={[styles.cell, styles.header]}>
                        {column}
                      </Text>
                    ))}
                  </View>
                  {result.rows.slice(0, visible).map((row, index) => (
                    <View key={JSON.stringify([index, row])} style={styles.row}>
                      {columns.map((column) => (
                        <Text key={column} selectable style={styles.cell}>
                          {typeof row[column] === "object"
                            ? JSON.stringify(row[column])
                            : String(row[column] ?? "—")}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
            {result.rows.length > visible && (
              <ActionButton
                quiet
                onPress={() => {
                  setVisible((value) => value + 20);
                }}
              >
                Mostrar mais linhas
              </ActionButton>
            )}
            <ActionButton
              quiet
              onPress={() => {
                setEvidence((value) => !value);
              }}
            >
              {evidence ? "Ocultar fontes e execução" : "Fontes e execução"}
            </ActionButton>
            {evidence && (
              <View style={styles.evidence}>
                <Text style={pageStyles.copy}>
                  Versão {result.manifest.revision.slice(0, 8)} ·{" "}
                  {new Date(result.manifest.completedAt).toLocaleString()}
                </Text>
                <Text selectable style={pageStyles.copy}>
                  Consulta: {result.manifest.query}
                </Text>
                <Text selectable style={pageStyles.copy}>
                  Argumentos: {JSON.stringify(result.manifest.arguments)}
                </Text>
                {result.manifest.sources.map((source) => (
                  <View key={source.path}>
                    <Text selectable style={pageStyles.rowTitle}>
                      {source.path}
                    </Text>
                    <Text selectable style={pageStyles.copy}>
                      {source.sha256}
                    </Text>
                  </View>
                ))}
                <Text style={pageStyles.rowTitle}>SQL executado</Text>
                <Text selectable style={styles.sql}>
                  {result.manifest.sql}
                </Text>
                <Text selectable style={pageStyles.copy}>
                  Execução {result.manifest.id} · {result.manifest.engine}
                </Text>
              </View>
            )}
          </View>
        </CompanionSheet>
      )}
    </>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    resource: { alignSelf: "flex-start", maxWidth: "100%" },
    content: { gap: 16 },
    row: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderColor: colors.line,
    },
    cell: {
      fontFamily: systemFont,
      width: 180,
      padding: 12,
      color: colors.ink,
      fontSize: 15,
      lineHeight: 22,
    },
    header: { fontWeight: "600", backgroundColor: colors.surface },
    evidence: { gap: 12 },
    sql: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 13,
      lineHeight: 20,
    },
  });
}

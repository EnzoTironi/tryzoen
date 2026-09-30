import { useMemo, useState } from "react";
import type { EveDynamicToolPart } from "eve/react";
import {
  ChartColumn,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  X,
} from "lucide-react-native";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SemanticQueryResultSchema } from "../library/semantic/schema";
import { SheetSurface } from "../sheet";
import { ResourceCard } from "../cards/resource";
import { IconButton } from "../icon-button";
import { systemFont, useColors } from "../theme";

const statusLabels = new Map([
  ["in_progress", "Em andamento"],
  ["in_review", "Em revisão"],
  ["done", "Concluído"],
]);

function displayName(value: string) {
  const words = value
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replace(/[-_]/gu, " ");
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}
function columnName(column: string) {
  if (column === "task") return "Tarefa";
  if (column === "owner") return "Responsável";
  return displayName(column);
}
function valueText(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

export function KnowledgeQueryCard({
  part,
}: {
  readonly part: EveDynamicToolPart;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const [open, setOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [executionOpen, setExecutionOpen] = useState(false);
  const [visible, setVisible] = useState(20);
  const parsed =
    part.state === "output-available"
      ? SemanticQueryResultSchema.safeParse(part.output)
      : null;
  const result = parsed?.success ? parsed.data : null;
  const title = result
    ? displayName(
        result.manifest.query
          .split("/")
          .at(-1)
          ?.replace(/\.json$/u, "") ?? "Análise"
      )
    : "Análise";
  const columns = result
    ? [...new Set(result.rows.flatMap((row) => Object.keys(row)))]
    : [];
  const availableWidth =
    Math.min(680, width - (compact ? 0 : 64)) -
    40 -
    4 * StyleSheet.hairlineWidth;
  const tableWidth = Math.max(availableWidth, columns.length * 140 + 80);
  const weights = columns.map((column, index) => {
    const numeric =
      !!result?.rows.length &&
      result.rows.every(
        (row) =>
          row[column] === null ||
          row[column] === undefined ||
          typeof row[column] === "number"
      );
    return { column, numeric, weight: index === 0 && !numeric ? 2 : 1 };
  });
  const totalWeight = weights.reduce(
    (total, column) => total + column.weight,
    0
  );
  const count = result
    ? `${result.rows.length} ${result.rows.length === 1 ? "resultado" : "resultados"}`
    : "";
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
          action={
            result ? <ChevronRight size={18} color={colors.muted} /> : undefined
          }
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
        <SheetSurface
          panelStyle={styles.panel}
          title={title}
          maxWidth={680}
          onClose={() => {
            setOpen(false);
          }}
        >
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              <Text style={styles.caption}>{count}</Text>
            </View>
            <IconButton
              label={`Fechar análise ${title}`}
              icon={X}
              quiet
              onPress={() => {
                setOpen(false);
              }}
            />
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            accessibilityLabel="Resultado e fontes da análise"
          >
            <View style={styles.freshness}>
              <Clock3 size={13} color={colors.muted} />
              <Text style={styles.caption}>
                Snapshot publicado · Atualização da origem desconhecida
              </Text>
            </View>
            {!result.rows.length ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nenhum resultado</Text>
                <Text style={styles.caption}>
                  A consulta não retornou linhas para estes argumentos.
                </Text>
              </View>
            ) : (
              <View style={styles.tableFrame}>
                <ScrollView
                  horizontal
                  style={styles.tableScroll}
                  accessibilityLabel="Tabela de resultados"
                >
                  <View
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Native View must retain table semantics on RNWeb and Expo.
                    role="table"
                    accessibilityLabel={`${count}, ${columns.length} colunas`}
                    style={{ width: tableWidth }}
                  >
                    <View // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Native View must retain table semantics on RNWeb and Expo.
                      role="row"
                      style={styles.tableHeader}
                    >
                      {weights.map(({ column, weight, numeric }) => (
                        <View
                          key={column}
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Native View must retain table semantics on RNWeb and Expo.
                          role="columnheader"
                          style={[
                            styles.cell,
                            { width: (tableWidth * weight) / totalWeight },
                          ]}
                        >
                          <Text
                            style={[
                              styles.columnTitle,
                              numeric && styles.numeric,
                            ]}
                          >
                            {columnName(column)}
                          </Text>
                        </View>
                      ))}
                    </View>
                    {result.rows.slice(0, visible).map((row, index) => (
                      <View
                        key={JSON.stringify([index, row])}
                        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Native View must retain table semantics on RNWeb and Expo.
                        role="row"
                        style={[
                          styles.row,
                          index % 2 === 1 && styles.alternateRow,
                        ]}
                      >
                        {weights.map(({ column, weight, numeric }) => {
                          const value = row[column];
                          const status =
                            column === "status" && typeof value === "string"
                              ? statusLabels.get(value)
                              : undefined;
                          return (
                            <View
                              key={column}
                              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Native View must retain table semantics on RNWeb and Expo.
                              role="cell"
                              style={[
                                styles.cell,
                                { width: (tableWidth * weight) / totalWeight },
                              ]}
                            >
                              {status ? (
                                <View style={styles.status}>
                                  <View
                                    style={[
                                      styles.statusDot,
                                      {
                                        backgroundColor:
                                          value === "in_progress"
                                            ? colors.accent
                                            : colors.muted,
                                      },
                                    ]}
                                  />
                                  <Text
                                    selectable
                                    accessibilityLabel={`${status} (${valueText(value)})`}
                                    style={styles.statusText}
                                  >
                                    {status}
                                  </Text>
                                </View>
                              ) : (
                                <Text
                                  selectable
                                  style={[
                                    styles.value,
                                    numeric && styles.numeric,
                                  ]}
                                >
                                  {valueText(value)}
                                </Text>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}
            {compact &&
              tableWidth > availableWidth &&
              result.rows.length > 0 && (
                <Text style={styles.caption}>
                  Deslize a tabela para ver todas as colunas.
                </Text>
              )}
            {result.rows.length > visible && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mostrar mais linhas"
                style={styles.more}
                onPress={() => {
                  setVisible((value) => value + 20);
                }}
              >
                <Text style={styles.moreText}>Mostrar mais linhas</Text>
                <Text style={styles.caption}>
                  {Math.min(visible, result.rows.length)} de{" "}
                  {result.rows.length}
                </Text>
              </Pressable>
            )}
            <View style={styles.provenance}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fontes da análise"
                aria-expanded={sourcesOpen}
                style={styles.disclosure}
                onPress={() => {
                  setSourcesOpen((value) => !value);
                }}
              >
                <Text style={styles.disclosureTitle}>Fontes</Text>
                <Text style={styles.caption}>
                  {result.manifest.sources.length}{" "}
                  {result.manifest.sources.length === 1
                    ? "arquivo"
                    : "arquivos"}
                </Text>
                {sourcesOpen ? (
                  <ChevronDown size={16} color={colors.muted} />
                ) : (
                  <ChevronRight size={16} color={colors.muted} />
                )}
              </Pressable>
              {sourcesOpen && (
                <View style={styles.sources}>
                  {result.manifest.sources.map((source) => (
                    <View key={source.path} style={styles.source}>
                      <View style={styles.sourceIcon}>
                        <FileText size={17} color={colors.muted} />
                      </View>
                      <View style={styles.sourceCopy}>
                        <View style={styles.sourceHeading}>
                          <Text style={styles.sourceTitle}>
                            {displayName(
                              source.path
                                .split("/")
                                .at(-1)
                                ?.replace(/\.[^.]+$/u, "") ?? source.path
                            )}
                          </Text>
                          <Text style={styles.fileType}>
                            {source.path.split(".").at(-1)?.toLocaleUpperCase()}
                          </Text>
                        </View>
                        <Text selectable style={styles.path}>
                          {source.path}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Detalhes da execução"
                aria-expanded={executionOpen}
                style={[styles.disclosure, styles.executionDisclosure]}
                onPress={() => {
                  setExecutionOpen((value) => !value);
                }}
              >
                <Text style={styles.disclosureTitle}>Detalhes da execução</Text>
                {executionOpen ? (
                  <ChevronDown size={16} color={colors.muted} />
                ) : (
                  <ChevronRight size={16} color={colors.muted} />
                )}
              </Pressable>
              {executionOpen && (
                <View style={styles.execution}>
                  <View style={styles.metadata}>
                    {[
                      [
                        "Concluída",
                        new Date(result.manifest.completedAt).toLocaleString(),
                      ],
                      [
                        "Iniciada",
                        new Date(result.manifest.startedAt).toLocaleString(),
                      ],
                      ["Versão", result.manifest.revision],
                      ["Execução", result.manifest.id],
                      ["Engine", result.manifest.engine],
                      ["Ator da execução", result.manifest.actor],
                      ["Workspace", result.manifest.workspaceId],
                    ].map(([label, value]) => (
                      <View
                        key={label}
                        style={[
                          styles.metadataItem,
                          compact && styles.compactMetadata,
                        ]}
                      >
                        <Text style={styles.fieldLabel}>{label}</Text>
                        <Text selectable style={styles.technical}>
                          {value}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.detailGroup}>
                    <Text style={styles.sectionTitle}>Consulta</Text>
                    <Text selectable style={styles.technical}>
                      {result.manifest.query}
                    </Text>
                    <Text style={styles.fieldLabel}>Argumentos</Text>
                    <Text selectable style={styles.code}>
                      {JSON.stringify(result.manifest.arguments, null, 2)}
                    </Text>
                  </View>
                  <View style={styles.detailGroup}>
                    <Text style={styles.sectionTitle}>SQL executado</Text>
                    <ScrollView
                      horizontal
                      accessibilityLabel="SQL executado"
                      style={styles.codeFrame}
                    >
                      <Text selectable style={styles.code}>
                        {result.manifest.sql}
                      </Text>
                    </ScrollView>
                  </View>
                  <View style={styles.detailGroup}>
                    <Text style={styles.sectionTitle}>Integridade</Text>
                    {[
                      ["SHA-256 da entrada", result.manifest.inputSha256],
                      ["SHA-256 do SQL", result.manifest.sqlSha256],
                      ...result.manifest.sources.map((source) => [
                        source.path,
                        source.sha256,
                      ]),
                    ].map(([label, value]) => (
                      <View key={label} style={styles.hash}>
                        <Text selectable style={styles.fieldLabel}>
                          {label}
                        </Text>
                        <Text selectable style={styles.technical}>
                          {value}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.detailGroup}>
                    <Text style={styles.sectionTitle}>
                      Limites e atualização
                    </Text>
                    <Text selectable style={styles.code}>
                      {JSON.stringify(result.manifest.limits, null, 2)}
                    </Text>
                    <Text selectable style={styles.technical}>
                      {result.manifest.freshness}
                    </Text>
                  </View>
                  <View style={styles.detailGroup}>
                    <Text style={styles.sectionTitle}>Dados originais</Text>
                    <ScrollView
                      horizontal
                      accessibilityLabel="Dados originais"
                      style={styles.codeFrame}
                    >
                      <Text selectable style={styles.code}>
                        {JSON.stringify(result.rows, null, 2)}
                      </Text>
                    </ScrollView>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </SheetSurface>
      )}
    </>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    resource: { alignSelf: "flex-start", maxWidth: "100%" },
    panel: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingBottom: 14,
      gap: 12,
    },
    heading: { flex: 1, minWidth: 0, gap: 3 },
    title: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: "600",
    },
    caption: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 12,
      lineHeight: 18,
      flexShrink: 1,
    },
    scroll: { flexGrow: 0, flexShrink: 1 },
    content: { paddingHorizontal: 20, paddingBottom: 20, gap: 14 },
    freshness: { flexDirection: "row", alignItems: "center", gap: 6 },
    tableFrame: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      borderRadius: 12,
      overflow: "hidden",
    },
    tableScroll: { flexGrow: 0 },
    tableHeader: { flexDirection: "row", backgroundColor: colors.wash },
    columnTitle: {
      fontFamily: systemFont,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: "600",
      color: colors.muted,
    },
    row: {
      flexDirection: "row",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      minHeight: 44,
    },
    alternateRow: { backgroundColor: colors.sidebar },
    cell: {
      paddingHorizontal: 12,
      paddingVertical: 11,
      justifyContent: "center",
      minWidth: 0,
    },
    value: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 14,
      lineHeight: 21,
    },
    numeric: { textAlign: "right", fontVariant: ["tabular-nums"] },
    status: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.wash,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 7,
    },
    statusDot: { width: 5, height: 5, borderRadius: 3 },
    statusText: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 12,
      lineHeight: 17,
    },
    provenance: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    disclosure: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    disclosureTitle: {
      fontFamily: systemFont,
      fontSize: 13,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.ink,
      flex: 1,
    },
    sources: { gap: 14, paddingTop: 4, paddingBottom: 16 },
    source: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    sourceIcon: {
      width: 30,
      height: 30,
      borderRadius: 8,
      backgroundColor: colors.wash,
      alignItems: "center",
      justifyContent: "center",
    },
    sourceCopy: { flex: 1, minWidth: 0, gap: 3 },
    sourceHeading: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    sourceTitle: {
      fontFamily: systemFont,
      fontSize: 13,
      lineHeight: 18,
      color: colors.ink,
      fontWeight: "500",
      flexShrink: 1,
    },
    fileType: {
      fontFamily: systemFont,
      fontSize: 10,
      lineHeight: 14,
      color: colors.muted,
      letterSpacing: 0.5,
    },
    path: {
      fontFamily: systemFont,
      fontSize: 11,
      lineHeight: 16,
      color: colors.muted,
    },
    executionDisclosure: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    execution: { gap: 20, paddingTop: 8 },
    metadata: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    metadataItem: { width: "48%", gap: 4, minWidth: 0 },
    compactMetadata: { width: "100%" },
    fieldLabel: {
      fontFamily: systemFont,
      fontSize: 11,
      lineHeight: 16,
      color: colors.muted,
    },
    technical: {
      fontFamily: systemFont,
      fontSize: 12,
      lineHeight: 18,
      color: colors.ink,
    },
    sectionTitle: {
      fontFamily: systemFont,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: "600",
      color: colors.ink,
    },
    detailGroup: { gap: 8 },
    hash: { gap: 3 },
    codeFrame: { backgroundColor: colors.wash, borderRadius: 10, flexGrow: 0 },
    code: {
      fontFamily: Platform.select({
        web: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
        ios: "Menlo",
        default: "monospace",
      }),
      fontSize: 11,
      lineHeight: 18,
      color: colors.ink,
      padding: 12,
    },
    more: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    moreText: {
      fontFamily: systemFont,
      fontSize: 13,
      lineHeight: 20,
      color: colors.accent,
      fontWeight: "500",
    },
    empty: { paddingVertical: 24, gap: 6 },
    emptyTitle: {
      fontFamily: systemFont,
      fontSize: 16,
      lineHeight: 22,
      color: colors.ink,
      fontWeight: "500",
    },
  });
}

import { useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FileText } from "lucide-react-native";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type {
  knowledgeProposalListSchema,
  knowledgeProposalReviewSchema,
} from "./knowledge-schema";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import { systemFont, useColors } from "../theme";
import { ontologyPath } from "./ontology/schema";
import { OntologyReview } from "./ontology/review";

export interface KnowledgeProposalData {
  readonly cacheKey: readonly unknown[];
  readonly operationId: () => string;
  readonly list: () => Promise<z.output<typeof knowledgeProposalListSchema>>;
  readonly read: (
    path: string
  ) => Promise<z.output<typeof knowledgeProposalReviewSchema>>;
  readonly review: (input: {
    proposal: string;
    expectedRevision: string;
    operationId: string;
    decision: "approve" | "reject";
  }) => Promise<{ revision: string }>;
}

export function KnowledgeProposals({
  data,
  query,
}: {
  readonly data: KnowledgeProposalData;
  readonly query: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const [path, setPath] = useState<string>();
  const proposals = useQuery({
    queryKey: [...data.cacheKey, "list"],
    queryFn: data.list,
    staleTime: 15_000,
  });
  const items = (proposals.isError ? undefined : proposals.data)?.items.filter(
    (item) =>
      `${item.title} ${item.summary}`
        .toLowerCase()
        .includes(query.toLowerCase().trim())
  );
  return (
    <View style={styles.collection}>
      <Text style={pageStyles.copy}>
        Review the changes Zoen suggests for your shared knowledge. Publishing
        updates all the files together.
      </Text>
      {proposals.isPending && (
        <Text style={pageStyles.copy}>Loading proposals…</Text>
      )}
      {proposals.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          Proposals could not be loaded.
        </Text>
      )}
      {(proposals.isError || !items?.length) && (
        <ActionButton
          quiet
          onPress={() => {
            void proposals.refetch();
          }}
        >
          Refresh proposals
        </ActionButton>
      )}
      {items?.map((item) => (
        <Pressable
          key={item.path}
          accessibilityRole="button"
          accessibilityLabel={`Review ${item.title}`}
          onPress={() => {
            setPath(item.path);
          }}
          style={styles.row}
        >
          <View style={styles.icon}>
            <FileText size={22} color={colors.muted} />
          </View>
          <View style={styles.caption}>
            <Text style={pageStyles.rowTitle}>{item.title}</Text>
            <Text numberOfLines={2} style={pageStyles.copy}>
              {item.summary}
            </Text>
            <Text style={styles.detail}>
              {item.files} {item.files === 1 ? "file" : "files"} · Awaiting
              review
            </Text>
          </View>
          <ChevronRight size={18} color={colors.muted} />
        </Pressable>
      ))}
      {items?.length === 0 && (
        <Text style={pageStyles.copy}>
          {query
            ? "No matching proposals."
            : "No changes awaiting review. Ask Zoen to propose records, connections, a definition or an analysis model."}
        </Text>
      )}
      {path && (
        <KnowledgeReview
          key={path}
          path={path}
          data={data}
          onClose={() => {
            setPath(undefined);
          }}
        />
      )}
    </View>
  );
}

function KnowledgeReview({
  path,
  data,
  onClose,
}: {
  readonly path: string;
  readonly data: KnowledgeProposalData;
  readonly onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const compact = useWindowDimensions().width < 720;
  const cache = useQueryClient();
  const review = useQuery({
    queryKey: [...data.cacheKey, "review", path],
    queryFn: () => data.read(path),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [selected, setSelected] = useState(0);
  const intent = useRef<{
    decision: "approve" | "reject";
    revision: string;
    operationId: string;
  }>(undefined);
  const decision = useMutation({
    mutationFn: async (choice: "approve" | "reject") => {
      if (!review.data)
        throw new Error("Refresh the proposal before reviewing it.");
      const revision = review.data.revision;
      if (
        intent.current?.decision !== choice ||
        intent.current.revision !== revision
      )
        intent.current = {
          decision: choice,
          revision,
          operationId: data.operationId(),
        };
      return data.review({
        proposal: path,
        expectedRevision: revision,
        decision: choice,
        operationId: intent.current.operationId,
      });
    },
    onSuccess: () => {
      cache.setQueryData<z.output<typeof knowledgeProposalListSchema>>(
        [...data.cacheKey, "list"],
        (list) =>
          list
            ? {
                ...list,
                items: list.items.filter((item) => item.path !== path),
              }
            : list
      );
      void cache.invalidateQueries({ queryKey: data.cacheKey });
      onClose();
    },
  });
  const snapshot = review.isError ? undefined : review.data;
  const change = snapshot?.changes[selected];
  return (
    <CompanionSheet title="Review changes" onClose={onClose} maxWidth={960}>
      {review.isPending && (
        <Text style={pageStyles.copy}>Loading changes…</Text>
      )}
      {review.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          The proposal is unavailable. Refresh to try again.
        </Text>
      )}
      {(review.isError ||
        decision.isError ||
        Boolean(snapshot?.conflicts.length)) && (
        <>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            {decision.error?.message ??
              "The source files changed. Ask Zoen to reconcile the proposal before publishing it."}
          </Text>
          <ActionButton
            quiet
            disabled={decision.isPending}
            onPress={() => {
              decision.reset();
              void review.refetch();
            }}
          >
            Refresh changes
          </ActionButton>
        </>
      )}
      {snapshot && (
        <>
          <Text accessibilityRole="header" style={pageStyles.heading}>
            {snapshot.proposal.title}
          </Text>
          <Text style={pageStyles.copy}>{snapshot.proposal.summary}</Text>
          <View style={styles.files}>
            {snapshot.changes.map((item, index) => (
              <Pressable
                key={item.path}
                accessibilityRole="button"
                accessibilityState={{ selected: selected === index }}
                onPress={() => {
                  setSelected(index);
                }}
                style={[styles.file, selected === index && styles.selectedFile]}
              >
                <FileText size={16} color={colors.muted} />
                <Text style={styles.fileName}>
                  {item.path.replace(/^knowledge\//u, "")}
                </Text>
              </Pressable>
            ))}
          </View>
          {change && (
            <View style={[styles.comparison, !compact && styles.columns]}>
              <KnowledgeSource
                label="Current"
                content={change.before}
                columns={!compact}
                ontology={change.path === ontologyPath}
              />
              <KnowledgeSource
                label="Proposed"
                content={change.after}
                columns={!compact}
                ontology={change.path === ontologyPath}
              />
            </View>
          )}
          <Text accessibilityRole="header" style={pageStyles.rowTitle}>
            Sources
          </Text>
          {snapshot.proposal.evidence.map((source) => (
            <View key={JSON.stringify(source)} style={styles.evidence}>
              {source.kind === "link" ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => {
                    void Linking.openURL(source.url);
                  }}
                >
                  <Text style={pageStyles.rowTitle}>{source.title} ↗</Text>
                  <Text style={styles.detail}>
                    {new URL(source.url).hostname}
                  </Text>
                </Pressable>
              ) : (
                <>
                  <Text style={pageStyles.rowTitle}>{source.path}</Text>
                  <Text style={styles.detail}>
                    Revision {source.revision.slice(0, 7)}
                  </Text>
                </>
              )}
              <Text selectable style={pageStyles.copy}>
                {source.excerpt}
              </Text>
            </View>
          ))}
          {snapshot.proposal.dependencies.length > 0 && (
            <Text style={styles.detail}>
              Also checks: {snapshot.proposal.dependencies.join(", ")}
            </Text>
          )}
          {snapshot.conflicts.length > 0 && (
            <Text style={styles.detail}>
              Changed sources: {snapshot.conflicts.join(", ")}
            </Text>
          )}
          {snapshot.canReview ? (
            <View style={styles.actions}>
              <ActionButton
                quiet
                disabled={decision.isPending}
                onPress={() => {
                  decision.mutate("reject");
                }}
              >
                {decision.isPending && decision.variables === "reject"
                  ? "Rejecting…"
                  : "Reject proposal"}
              </ActionButton>
              <ActionButton
                disabled={
                  decision.isPending ||
                  review.isFetching ||
                  snapshot.conflicts.length > 0
                }
                onPress={() => {
                  decision.mutate("approve");
                }}
              >
                {decision.isPending && decision.variables === "approve"
                  ? "Publishing…"
                  : `Publish ${snapshot.changes.length} ${snapshot.changes.length === 1 ? "file" : "files"}`}
              </ActionButton>
            </View>
          ) : (
            <Text style={pageStyles.copy}>
              An administrator can publish or reject this proposal.
            </Text>
          )}
        </>
      )}
    </CompanionSheet>
  );
}

function KnowledgeSource({
  label,
  content,
  columns,
  ontology,
}: {
  readonly label: string;
  readonly content: string | null;
  readonly columns: boolean;
  readonly ontology: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.source, columns && styles.sourceColumn]}>
      <Text style={styles.sourceLabel}>{label}</Text>
      {ontology && content !== null ? (
        <OntologyReview content={content} />
      ) : (
        <Text selectable style={styles.sourceText}>
          {content ??
            (label === "Current" ? "New file" : "File will be removed")}
        </Text>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    collection: { gap: 14 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    icon: {
      width: 44,
      height: 44,
      borderRadius: 13,
      backgroundColor: colors.wash,
      alignItems: "center",
      justifyContent: "center",
    },
    caption: { flex: 1, gap: 5 },
    detail: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 12,
      lineHeight: 18,
    },
    files: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    file: {
      maxWidth: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      padding: 10,
      borderRadius: 12,
      backgroundColor: colors.wash,
    },
    selectedFile: { backgroundColor: "#e4ebf1" },
    fileName: {
      fontFamily: systemFont,
      flexShrink: 1,
      fontSize: 13,
      color: colors.ink,
    },
    comparison: { gap: 12 },
    columns: { flexDirection: "row" },
    sourceColumn: { flex: 1 },
    source: {
      minWidth: 0,
      padding: 16,
      borderRadius: 16,
      backgroundColor: colors.wash,
      gap: 10,
    },
    sourceLabel: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 12,
      fontWeight: "600",
    },
    sourceText: {
      color: colors.ink,
      fontSize: 13,
      lineHeight: 21,
      fontFamily: "monospace",
    },
    evidence: {
      gap: 6,
      padding: 14,
      borderRadius: 14,
      backgroundColor: colors.wash,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      justifyContent: "flex-end",
      paddingTop: 10,
    },
  });
}

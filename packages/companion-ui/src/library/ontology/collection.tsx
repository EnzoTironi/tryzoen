import { useState } from "react";
import type { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import type {
  OntologyReadResultSchema,
  OntologyReadSchema,
  OntologySourceSchema,
  OntologyActInputSchema,
  OntologyPublishedResultSchema,
} from "./schema";
import { OntologyDossier } from "./dossier";
import { OntologyHistory } from "./history";
import { ontologyReadOptions } from "./query";
import type { DocumentHistoryData } from "../../document-history";
import { ActionButton } from "../../button";
import { usePageStyles } from "../../page";
import { OntologyRecords } from "./records";
import { OntologyActionEditor } from "./action-editor";
import {
  beginOntologyAction,
  ontologyActionFailure,
  type OntologyActionDraft,
} from "./action-draft";

export interface OntologyData {
  readonly cacheKey: readonly unknown[];
  readonly read: (
    input: z.output<typeof OntologyReadSchema>
  ) => Promise<z.output<typeof OntologyReadResultSchema>>;
  readonly source: (
    citation: z.output<typeof OntologySourceSchema>
  ) => Promise<string | null>;
  readonly history: DocumentHistoryData["list"];
  readonly operationId: () => z.output<
    typeof OntologyActInputSchema
  >["operationId"];
  readonly act: (
    input: z.output<typeof OntologyActInputSchema>
  ) => Promise<z.output<typeof OntologyPublishedResultSchema>>;
}

export function OntologyCollection({
  data,
  query,
}: {
  readonly data: OntologyData;
  readonly query: string;
}) {
  return (
    <ScopedOntologyCollection
      key={JSON.stringify(data.cacheKey)}
      data={data}
      query={query}
    />
  );
}

function ScopedOntologyCollection({
  data,
  query,
}: Parameters<typeof OntologyCollection>[0]) {
  const pageStyles = usePageStyles();
  const [selected, setSelected] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [view, setView] = useState<z.output<typeof OntologyReadSchema>>({});
  const [draft, setDraft] = useState<OntologyActionDraft | null>(null);
  const knowledge = useQuery(ontologyReadOptions(data, view));
  const graph = knowledge.isError ? undefined : knowledge.data?.graph;
  const entity = graph?.entities.find((item) => item.id === selected);
  return (
    <View style={styles.collection}>
      <Text style={pageStyles.copy}>
        Useful facts, the people and projects they connect, and the evidence
        behind them.
      </Text>
      <ActionButton
        quiet
        onPress={() => {
          setHistoryOpen(true);
        }}
      >
        {`${view.asOf ? `Recorded by ${new Date(view.asOf).toLocaleString()}` : view.revision ? `Recorded version ${view.revision.slice(0, 8)}` : "Current knowledge"}${view.validOn ? ` · Valid on ${view.validOn}` : " · All dates"}`}
      </ActionButton>
      {historyOpen && (
        <OntologyHistory
          data={data}
          view={view}
          onApply={(next) => {
            setSelected(undefined);
            setView(next);
            setHistoryOpen(false);
          }}
          onClose={() => {
            setHistoryOpen(false);
          }}
        />
      )}
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
      {graph &&
        (knowledge.data?.asOf && knowledge.data.revision === null ? (
          <Text style={pageStyles.copy}>
            Nothing had been published by this recorded time.
          </Text>
        ) : (
          <OntologyRecords graph={graph} query={query} onOpen={setSelected} />
        ))}
      {entity && knowledge.data && !draft && (
        <OntologyDossier
          key={entity.id}
          entity={entity}
          record={knowledge.data}
          data={data}
          onSelect={setSelected}
          onAction={(actionId) => {
            setDraft(beginOntologyAction(knowledge.data, entity.id, actionId));
          }}
          onClose={() => {
            setSelected(undefined);
          }}
        />
      )}
      {draft &&
        knowledge.data?.mayManage &&
        ontologyActionFailure(knowledge.error) !== "denied" && (
          <OntologyActionEditor
            initialDraft={draft}
            data={data}
            onClose={() => {
              setDraft(null);
            }}
          />
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  collection: { gap: 16 },
});

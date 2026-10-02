import { useState } from "react";
import type { z } from "zod";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ActionButton } from "../../button";
import { CompanionSheet } from "../../sheet";
import { usePageStyles } from "../../page";
import type { OntologyData } from "./collection";
import type { OntologyReadResultSchema } from "./schema";
import { OntologyEvidence } from "./evidence";
import {
  ontologyActionInput,
  ontologyActionFailure,
  rebaseOntologyAction,
  type OntologyActionDraft,
} from "./action-draft";

type ActionState =
  | { readonly kind: "editing"; readonly draft: OntologyActionDraft }
  | {
      readonly kind: "review" | "sending" | "uncertain" | "conflict";
      readonly draft: OntologyActionDraft;
      readonly input: ReturnType<typeof ontologyActionInput>;
    }
  | {
      readonly kind: "comparison";
      readonly draft: OntologyActionDraft;
      readonly input: ReturnType<typeof ontologyActionInput>;
      readonly current: z.output<typeof OntologyReadResultSchema>;
    }
  | { readonly kind: "denied" };

/** Shared web/desktop/native review of one declared full-claim action. */
export function OntologyActionEditor({
  initialDraft,
  data,
  onClose,
}: {
  readonly initialDraft: OntologyActionDraft;
  readonly data: OntologyData;
  readonly onClose: () => void;
}) {
  const page = usePageStyles();
  const [state, setState] = useState<ActionState>({
    kind: "editing",
    draft: initialDraft,
  });
  const [error, setError] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const close = () => {
    if (state.kind === "sending" || loadingCurrent) return;
    if (state.kind === "uncertain") {
      setError(
        "The result is still unknown. Retry this exact change to resolve it before starting another."
      );
      return;
    }
    if (state.kind === "denied") {
      onClose();
      return;
    }
    if (
      state.kind !== "editing" ||
      JSON.stringify(state.draft) !== JSON.stringify(initialDraft)
    )
      setConfirmDiscard(true);
    else onClose();
  };
  const send = async () => {
    if (state.kind !== "review" && state.kind !== "uncertain") return;
    const attempt = state;
    setState({ ...attempt, kind: "sending" });
    setError(undefined);
    try {
      await data.act(attempt.input);
      onClose();
    } catch (cause) {
      switch (ontologyActionFailure(cause)) {
        case "conflict":
          setState({ ...attempt, kind: "conflict" });
          setError(
            "Knowledge changed or this attempt conflicts. Your draft and reviewed head are unchanged."
          );
          break;
        case "denied":
          setState({ kind: "denied" });
          break;
        case "invalid":
          setState({ kind: "editing", draft: attempt.draft });
          setConfirmed(false);
          setError(
            "Check the value, dates and cited passages. Nothing was saved by this attempt."
          );
          break;
        case "uncertain":
          setState({ ...attempt, kind: "uncertain" });
          setError(
            "The response was interrupted. This change may already have been saved. Retry uses the identical operation and reviewed head."
          );
          break;
      }
    }
  };
  const reviewCurrent = async () => {
    if (state.kind !== "conflict" || loadingCurrent) return;
    const attempt = state;
    setLoadingCurrent(true);
    setError(undefined);
    try {
      const current = await data.read({});
      if (!current.mayManage) setState({ kind: "denied" });
      else setState({ ...attempt, kind: "comparison", current });
    } catch (cause) {
      if (ontologyActionFailure(cause) === "denied")
        setState({ kind: "denied" });
      else
        setError(
          "Current knowledge could not be loaded. Your draft is still here."
        );
    } finally {
      setLoadingCurrent(false);
    }
  };
  if (state.kind === "denied")
    return (
      <CompanionSheet title="Knowledge action" onClose={close}>
        <Text accessibilityRole="alert" style={page.copy}>
          You can no longer change this knowledge. Reopen it with your current
          access.
        </Text>
        <ActionButton onPress={onClose}>Close</ActionButton>
      </CompanionSheet>
    );
  const { draft } = state;
  const edit = (next: OntologyActionDraft) => {
    if (state.kind !== "editing") return;
    setState({ kind: "editing", draft: next });
    setConfirmed(false);
    setError(undefined);
  };
  const original = draft.record.graph.entities.find(
    (entity) => entity.id === draft.entityId
  )?.properties[draft.property.id];
  const currentClaim =
    state.kind === "comparison"
      ? state.current.graph.entities.find(
          (entity) => entity.id === draft.entityId
        )?.properties[draft.property.id]
      : undefined;
  const needsConfirmation =
    state.kind !== "editing" &&
    (draft.metadata === "clear" || state.input.sources.length > 0);
  return (
    <CompanionSheet title={draft.title} onClose={close}>
      <View style={styles.form}>
        <Text style={page.copy}>
          {draft.property.name} · Reviewed version{" "}
          {draft.expectedRevision.slice(0, 8)}
        </Text>
        <Text style={page.copy}>
          Captured value:{" "}
          {original?.value === null || original === undefined
            ? "Not established"
            : String(original.value)}
        </Text>
        {error && (
          <Text accessibilityRole="alert" style={page.copy}>
            {error}
          </Text>
        )}
        {confirmDiscard && (
          <View style={styles.form}>
            <Text accessibilityRole="header" style={page.rowTitle}>
              Discard this unsaved draft?
            </Text>
            <ActionButton
              quiet
              onPress={() => {
                setConfirmDiscard(false);
              }}
            >
              Keep editing
            </ActionButton>
            <ActionButton onPress={onClose}>Discard draft</ActionButton>
          </View>
        )}
        {state.kind === "editing" ? (
          <>
            <Text accessibilityRole="header" style={page.rowTitle}>
              New value
            </Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Value establishment"
            >
              <Choice
                label="Not established"
                selected={draft.unknown}
                onPress={() => {
                  edit({ ...draft, unknown: true });
                }}
              />
              <Choice
                label="Set a value"
                selected={!draft.unknown}
                onPress={() => {
                  edit({ ...draft, unknown: false });
                }}
              />
            </View>
            {!draft.unknown &&
              (draft.property.type === "boolean" ? (
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel={`New ${draft.property.name}`}
                  style={styles.row}
                >
                  <Choice
                    label="True"
                    selected={draft.value === "true"}
                    onPress={() => {
                      edit({ ...draft, value: "true" });
                    }}
                  />
                  <Choice
                    label="False"
                    selected={draft.value === "false"}
                    onPress={() => {
                      edit({ ...draft, value: "false" });
                    }}
                  />
                </View>
              ) : (
                <TextInput
                  accessibilityLabel={`New ${draft.property.name}`}
                  value={draft.value}
                  onChangeText={(value) => {
                    edit({ ...draft, value });
                  }}
                  maxLength={2000}
                  inputMode={
                    draft.property.type === "number" ? "decimal" : "text"
                  }
                  placeholder={
                    draft.property.type === "date"
                      ? "YYYY-MM-DD"
                      : draft.property.name
                  }
                  style={page.field}
                />
              ))}
            <Text accessibilityRole="header" style={page.rowTitle}>
              Evidence and world-valid dates
            </Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Evidence and date choice"
            >
              <Choice
                label="Keep captured evidence and dates"
                selected={draft.metadata === "keep"}
                onPress={() => {
                  edit({ ...draft, metadata: "keep" });
                }}
              />
              <Choice
                label="Replace evidence and dates"
                selected={draft.metadata === "replace"}
                onPress={() => {
                  edit({ ...draft, metadata: "replace" });
                }}
              />
              <Choice
                label="Clear evidence and dates"
                selected={draft.metadata === "clear"}
                onPress={() => {
                  edit({ ...draft, metadata: "clear" });
                }}
              />
            </View>
            {draft.metadata === "keep" && (
              <View style={styles.form}>
                <Text
                  style={page.copy}
                >{`Captured at version ${draft.record.revision?.slice(0, 8) ?? "none"}. Review this evidence against your new value.`}</Text>
                <OntologyEvidence
                  claim={original ?? { sources: [], validTime: null }}
                  record={draft.record}
                  data={data}
                />
              </View>
            )}
            {draft.metadata === "clear" && (
              <Text style={page.copy}>
                This removes evidence and dates from the current claim. Its
                previously published version remains in history.
              </Text>
            )}
            {draft.metadata === "replace" && (
              <>
                {draft.sources.map((citation, index) => (
                  <View key={citation.sourceKey} style={styles.form}>
                    <Text style={page.rowTitle}>{`Source ${index + 1}`}</Text>
                    {(
                      [
                        "path",
                        "revision",
                        "excerpt",
                      ] satisfies (keyof typeof citation)[]
                    ).map((field) => (
                      <TextInput
                        key={field}
                        accessibilityLabel={`Source ${index + 1} ${field}`}
                        value={citation[field]}
                        onChangeText={(value) => {
                          edit({
                            ...draft,
                            sources: draft.sources.map((source, item) =>
                              item === index
                                ? { ...source, [field]: value }
                                : source
                            ),
                          });
                        }}
                        placeholder={
                          field === "path"
                            ? "knowledge/source.md"
                            : field === "revision"
                              ? "Recorded source version"
                              : "Exact supporting passage"
                        }
                        maxLength={
                          field === "excerpt"
                            ? 2000
                            : field === "revision"
                              ? 40
                              : 200
                        }
                        multiline={field === "excerpt"}
                        autoCapitalize="none"
                        style={page.field}
                      />
                    ))}
                    <ActionButton
                      quiet
                      onPress={() => {
                        edit({
                          ...draft,
                          sources: draft.sources.filter(
                            (_, item) => item !== index
                          ),
                        });
                      }}
                    >{`Remove source ${index + 1}`}</ActionButton>
                  </View>
                ))}
                <ActionButton
                  quiet
                  disabled={draft.sources.length >= 10}
                  onPress={() => {
                    edit({
                      ...draft,
                      sources: [
                        ...draft.sources,
                        {
                          sourceKey: data.operationId(),
                          path: "",
                          revision: "",
                          excerpt: "",
                        },
                      ],
                    });
                  }}
                >
                  Add cited source
                </ActionButton>
                <TextInput
                  accessibilityLabel="Valid from date"
                  value={draft.from}
                  onChangeText={(from) => {
                    edit({ ...draft, from });
                  }}
                  placeholder="Valid from · YYYY-MM-DD, optional"
                  maxLength={10}
                  autoCapitalize="none"
                  style={page.field}
                />
                <TextInput
                  accessibilityLabel="Exclusive valid until date"
                  value={draft.until}
                  onChangeText={(until) => {
                    edit({ ...draft, until });
                  }}
                  placeholder="Until · YYYY-MM-DD, exclusive, optional"
                  maxLength={10}
                  autoCapitalize="none"
                  style={page.field}
                />
                <Text style={page.copy}>
                  Dates require cited evidence. An empty date stays unknown; the
                  end date is exclusive.
                </Text>
              </>
            )}
            <ActionButton
              onPress={() => {
                try {
                  const input = ontologyActionInput(draft, data.operationId());
                  setState({ kind: "review", draft, input });
                  setConfirmed(false);
                  setError(undefined);
                } catch {
                  setError(
                    "Check the value, exact source paths and revisions, cited passages and dates before reviewing."
                  );
                }
              }}
            >
              Review change
            </ActionButton>
          </>
        ) : (
          <>
            <Text accessibilityRole="header" style={page.rowTitle}>
              Your reviewed change
            </Text>
            <Text selectable style={page.copy}>
              {state.input.value === null
                ? "Not established"
                : String(state.input.value)}
            </Text>
            {state.input.sources.map((source) => (
              <View key={JSON.stringify(source)} style={styles.form}>
                <Text selectable style={page.copy}>
                  {source.excerpt}
                </Text>
                <Text
                  selectable
                  style={page.copy}
                >{`${source.path} · ${source.revision}`}</Text>
              </View>
            ))}
            <Text style={page.copy}>
              {state.input.validTime
                ? `Valid from ${state.input.validTime.from ?? "unknown"} · Until ${state.input.validTime.until ?? "unknown"} (exclusive)`
                : "World-valid dates not established"}
            </Text>
            <Text style={page.copy}>
              Publishing replaces this complete property claim. Sources are
              checked against current authorized files.
            </Text>
            {state.kind === "review" && (
              <>
                {needsConfirmation && (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={
                      draft.metadata === "clear"
                        ? "Remove the current evidence and dates"
                        : "I reviewed that this evidence supports the new value and dates"
                    }
                    accessibilityState={{ checked: confirmed }}
                    onPress={() => {
                      setConfirmed(!confirmed);
                    }}
                    style={({ pressed }) => [
                      styles.choice,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={page.copy}
                    >{`${confirmed ? "☑" : "☐"} ${draft.metadata === "clear" ? "Remove the current evidence and dates" : "I reviewed that this evidence supports the new value and dates"}`}</Text>
                  </Pressable>
                )}
                <ActionButton
                  disabled={needsConfirmation && !confirmed}
                  onPress={() => {
                    void send();
                  }}
                >
                  Publish change
                </ActionButton>
                <ActionButton
                  quiet
                  onPress={() => {
                    setState({ kind: "editing", draft });
                    setConfirmed(false);
                  }}
                >
                  Back to edit
                </ActionButton>
              </>
            )}
            {state.kind === "sending" && (
              <Text accessibilityLiveRegion="polite" style={page.copy}>
                Publishing…
              </Text>
            )}
            {state.kind === "uncertain" && (
              <ActionButton
                onPress={() => {
                  void send();
                }}
              >
                Retry this exact change
              </ActionButton>
            )}
            {state.kind === "conflict" && (
              <ActionButton
                disabled={loadingCurrent}
                onPress={() => {
                  void reviewCurrent();
                }}
              >
                {loadingCurrent
                  ? "Loading current knowledge…"
                  : "Review current knowledge"}
              </ActionButton>
            )}
            {state.kind === "comparison" && (
              <>
                <Text accessibilityRole="header" style={page.rowTitle}>
                  Current published claim
                </Text>
                <Text
                  style={page.copy}
                >{`Version ${state.current.revision?.slice(0, 8) ?? "none"} · ${currentClaim?.value === null || currentClaim === undefined ? "Not established" : String(currentClaim.value)}`}</Text>
                {currentClaim && (
                  <OntologyEvidence
                    claim={currentClaim}
                    record={state.current}
                    data={data}
                  />
                )}
                <Text style={page.copy}>
                  Your draft has not been rebased. Review this difference before
                  using the current head; a new operation will be created.
                </Text>
                <ActionButton
                  onPress={() => {
                    const rebased = rebaseOntologyAction(draft, state.current);
                    if (!rebased) {
                      setError(
                        "This action or its property changed. Discard this draft and reopen the current record."
                      );
                      return;
                    }
                    setState({ kind: "editing", draft: rebased });
                    setConfirmed(false);
                    setError(undefined);
                  }}
                >
                  Use reviewed current head
                </ActionButton>
              </>
            )}
          </>
        )}
        <ActionButton
          quiet
          disabled={state.kind === "sending" || loadingCurrent}
          onPress={close}
        >
          Close
        </ActionButton>
      </View>
    </CompanionSheet>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const page = usePageStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
    >
      <Text style={page.copy}>{`${selected ? "◉" : "○"} ${label}`}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  row: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  choice: { minHeight: 44, justifyContent: "center", paddingVertical: 10 },
  pressed: { opacity: 0.65 },
});

import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ActionButton } from "../../button";
import { CompanionSheet } from "../../sheet";
import { usePageStyles } from "../../page";
import type { OntologyData } from "./collection";
import { OntologyEvidence } from "./evidence";
import {
  ontologyActionInput,
  ontologyActionFailure,
  rebaseOntologyAction,
  startOntologyAction,
  discardOntologyAction,
  ontologyPropertyClaim,
  type OntologyActionDraft,
  type OntologyActionState,
} from "./action-draft";

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
  const [state, setState] = useState<OntologyActionState>({
    kind: "editing",
    draft: initialDraft,
  });
  const liveState = useRef(state);
  const update = (next: OntologyActionState) => {
    liveState.current = next;
    setState(next);
  };
  const [error, setError] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const liveConfirmation = useRef<string | null>(null);
  const clearConfirmation = () => {
    liveConfirmation.current = null;
    setConfirmed(false);
  };
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const liveDiscardPrompt = useRef(false);
  const discardPrompt = (shown: boolean) => {
    liveDiscardPrompt.current = shown;
    setConfirmDiscard(shown);
  };
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const liveLoading = useRef(false);
  const close = () => {
    const current = liveState.current;
    if (current.kind === "sending" || liveLoading.current) return;
    if (current.kind === "uncertain") {
      setError(
        "The result is still unknown. Retry this exact change to resolve it before starting another."
      );
      return;
    }
    if (current.kind === "denied") {
      onClose();
      return;
    }
    if (
      current.kind !== "editing" ||
      JSON.stringify(current.draft) !== JSON.stringify(initialDraft)
    )
      discardPrompt(true);
    else onClose();
  };
  const discard = () => {
    if (!liveDiscardPrompt.current) return;
    const next = discardOntologyAction(liveState.current, liveLoading.current);
    discardPrompt(false);
    if (next.kind === "closed") onClose();
    else
      setError(
        "This attempt is still being resolved. Its frozen operation and draft remain open."
      );
  };
  const send = async (operationId: string) => {
    if (liveDiscardPrompt.current) return;
    const current = liveState.current;
    if (current.kind !== "review" && current.kind !== "uncertain") return;
    if (current.input.operationId !== operationId) return;
    if (
      current.kind === "review" &&
      (current.draft.metadata === "clear" ||
        current.input.sources.length > 0) &&
      liveConfirmation.current !== operationId
    )
      return;
    const attempt = startOntologyAction(current);
    if (attempt.kind !== "sending") return;
    discardPrompt(false);
    update(attempt);
    setError(undefined);
    try {
      await data.act(attempt.input);
      onClose();
    } catch (cause) {
      switch (ontologyActionFailure(cause)) {
        case "conflict":
          update({ ...attempt, kind: "conflict" });
          setError(
            "Knowledge changed or this attempt conflicts. Your draft and reviewed head are unchanged."
          );
          break;
        case "denied":
          update({ kind: "denied" });
          break;
        case "invalid":
          update({ kind: "editing", draft: attempt.draft });
          clearConfirmation();
          setError(
            "Check the value, dates and cited passages. Nothing was saved by this attempt."
          );
          break;
        case "uncertain":
          update({ ...attempt, kind: "uncertain" });
          setError(
            "The response was interrupted. This change may already have been saved. Retry uses the identical operation and reviewed head."
          );
          break;
      }
    }
  };
  const reviewCurrent = async (operationId: string) => {
    const current = liveState.current;
    if (
      current.kind !== "conflict" ||
      liveLoading.current ||
      liveDiscardPrompt.current
    )
      return;
    if (current.input.operationId !== operationId) return;
    const attempt = current;
    liveLoading.current = true;
    setLoadingCurrent(true);
    setError(undefined);
    try {
      const latest = await data.read({});
      if (!latest.mayManage) update({ kind: "denied" });
      else update({ ...attempt, kind: "comparison", current: latest });
    } catch (cause) {
      if (ontologyActionFailure(cause) === "denied") update({ kind: "denied" });
      else
        setError(
          "Current knowledge could not be loaded. Your draft is still here."
        );
    } finally {
      liveLoading.current = false;
      setLoadingCurrent(false);
    }
  };
  if (confirmDiscard)
    return (
      <CompanionSheet
        title="Discard this draft?"
        onClose={() => {
          discardPrompt(false);
        }}
      >
        <Text accessibilityRole="header" style={page.rowTitle}>
          Discard this unsaved draft?
        </Text>
        <ActionButton
          quiet
          onPress={() => {
            discardPrompt(false);
          }}
        >
          Keep editing
        </ActionButton>
        <ActionButton onPress={discard}>Discard draft</ActionButton>
      </CompanionSheet>
    );
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
    const current = liveState.current;
    if (
      current.kind !== "editing" ||
      liveDiscardPrompt.current ||
      current.draft.expectedRevision !== next.expectedRevision
    )
      return;
    update({ kind: "editing", draft: next });
    clearConfirmation();
    setError(undefined);
  };
  const original = ontologyPropertyClaim(
    draft.record.graph.entities.find((entity) => entity.id === draft.entityId)
      ?.properties,
    draft.property.id
  );
  const currentClaim =
    state.kind === "comparison"
      ? ontologyPropertyClaim(
          state.current.graph.entities.find(
            (entity) => entity.id === draft.entityId
          )?.properties,
          draft.property.id
        )
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
                const current = liveState.current;
                if (current.kind !== "editing" || liveDiscardPrompt.current)
                  return;
                try {
                  const input = ontologyActionInput(
                    current.draft,
                    data.operationId()
                  );
                  update({ kind: "review", draft: current.draft, input });
                  clearConfirmation();
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
                      const current = liveState.current;
                      if (
                        current.kind !== "review" ||
                        current.input.operationId !== state.input.operationId ||
                        liveDiscardPrompt.current
                      )
                        return;
                      const next =
                        liveConfirmation.current !== current.input.operationId;
                      liveConfirmation.current = next
                        ? current.input.operationId
                        : null;
                      setConfirmed(next);
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
                    void send(state.input.operationId);
                  }}
                >
                  Publish change
                </ActionButton>
                <ActionButton
                  quiet
                  onPress={() => {
                    const current = liveState.current;
                    if (
                      current.kind !== "review" ||
                      current.input.operationId !== state.input.operationId ||
                      liveDiscardPrompt.current
                    )
                      return;
                    update({ kind: "editing", draft: current.draft });
                    clearConfirmation();
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
                  void send(state.input.operationId);
                }}
              >
                Retry this exact change
              </ActionButton>
            )}
            {state.kind === "conflict" && (
              <ActionButton
                disabled={loadingCurrent}
                onPress={() => {
                  void reviewCurrent(state.input.operationId);
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
                    const current = liveState.current;
                    if (
                      current.kind !== "comparison" ||
                      current.input.operationId !== state.input.operationId ||
                      liveDiscardPrompt.current
                    )
                      return;
                    const rebased = rebaseOntologyAction(
                      current.draft,
                      current.current
                    );
                    if (!rebased) {
                      setError(
                        "This action or its property changed. Discard this draft and reopen the current record."
                      );
                      return;
                    }
                    update({ kind: "editing", draft: rebased });
                    clearConfirmation();
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

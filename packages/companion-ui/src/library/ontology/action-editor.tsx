import { useI18n, Translated } from "./../../i18n";

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
  const { t } = useI18n();
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
        t(
          "The result is still unknown. Retry this exact change to resolve it before starting another."
        )
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
        t(
          "This attempt is still being resolved. Its frozen operation and draft remain open."
        )
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
            t(
              "Knowledge changed or this attempt conflicts. Your draft and reviewed head are unchanged."
            )
          );
          break;
        case "denied":
          update({ kind: "denied" });
          break;
        case "invalid":
          update({ kind: "editing", draft: attempt.draft });
          clearConfirmation();
          setError(
            t(
              "Check the value, dates and cited passages. Nothing was saved by this attempt."
            )
          );
          break;
        case "uncertain":
          update({ ...attempt, kind: "uncertain" });
          setError(
            t(
              "The response was interrupted. This change may already have been saved. Retry uses the identical operation and reviewed head."
            )
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
          t("Current knowledge could not be loaded. Your draft is still here.")
        );
    } finally {
      liveLoading.current = false;
      setLoadingCurrent(false);
    }
  };
  if (confirmDiscard)
    return (
      <CompanionSheet
        title={t("Discard this draft?")}
        onClose={() => {
          discardPrompt(false);
        }}
      >
        <Text accessibilityRole="header" style={page.rowTitle}>
          {t("Discard this unsaved draft?")}
        </Text>
        <ActionButton
          quiet
          onPress={() => {
            discardPrompt(false);
          }}
        >
          {t("Keep editing")}
        </ActionButton>
        <ActionButton onPress={discard}>{t("Discard draft")}</ActionButton>
      </CompanionSheet>
    );
  if (state.kind === "denied")
    return (
      <CompanionSheet title={t("Knowledge action")} onClose={close}>
        <Text accessibilityRole="alert" style={page.copy}>
          {t(
            "You can no longer change this knowledge. Reopen it with your current access."
          )}
        </Text>
        <ActionButton onPress={onClose}>{t("Close")}</ActionButton>
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
          <Translated
            message="{value1} · Reviewed version {value2}"
            values={{
              value1: draft.property.name,
              value2: draft.expectedRevision.slice(0, 8),
            }}
          />
        </Text>
        <Text style={page.copy}>
          <Translated
            message="Captured value: {value1}"
            values={{
              value1:
                original?.value === null || original === undefined
                  ? t("Not established")
                  : String(original.value),
            }}
          />
        </Text>
        {error && (
          <Text accessibilityRole="alert" style={page.copy}>
            {error}
          </Text>
        )}
        {state.kind === "editing" ? (
          <>
            <Text accessibilityRole="header" style={page.rowTitle}>
              {t("New value")}
            </Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t("Value establishment")}
            >
              <Choice
                label={t("Not established")}
                selected={draft.unknown}
                onPress={() => {
                  edit({ ...draft, unknown: true });
                }}
              />
              <Choice
                label={t("Set a value")}
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
                  accessibilityLabel={t("New {value1}", {
                    value1: draft.property.name,
                  })}
                  style={styles.row}
                >
                  <Choice
                    label={t("True")}
                    selected={draft.value === "true"}
                    onPress={() => {
                      edit({ ...draft, value: "true" });
                    }}
                  />
                  <Choice
                    label={t("False")}
                    selected={draft.value === "false"}
                    onPress={() => {
                      edit({ ...draft, value: "false" });
                    }}
                  />
                </View>
              ) : (
                <TextInput
                  accessibilityLabel={t("New {value1}", {
                    value1: draft.property.name,
                  })}
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
                      ? t("YYYY-MM-DD")
                      : draft.property.name
                  }
                  style={page.field}
                />
              ))}
            <Text accessibilityRole="header" style={page.rowTitle}>
              {t("Evidence and world-valid dates")}
            </Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t("Evidence and date choice")}
            >
              <Choice
                label={t("Keep captured evidence and dates")}
                selected={draft.metadata === "keep"}
                onPress={() => {
                  edit({ ...draft, metadata: "keep" });
                }}
              />
              <Choice
                label={t("Replace evidence and dates")}
                selected={draft.metadata === "replace"}
                onPress={() => {
                  edit({ ...draft, metadata: "replace" });
                }}
              />
              <Choice
                label={t("Clear evidence and dates")}
                selected={draft.metadata === "clear"}
                onPress={() => {
                  edit({ ...draft, metadata: "clear" });
                }}
              />
            </View>
            {draft.metadata === "keep" && (
              <View style={styles.form}>
                <Text style={page.copy}>
                  {t(
                    "Captured at version {value1}. Review this evidence against your new value.",
                    { value1: draft.record.revision?.slice(0, 8) ?? "none" }
                  )}
                </Text>
                <OntologyEvidence
                  claim={original ?? { sources: [], validTime: null }}
                  record={draft.record}
                  data={data}
                />
              </View>
            )}
            {draft.metadata === "clear" && (
              <Text style={page.copy}>
                {t(
                  "This removes evidence and dates from the current claim. Its previously published version remains in history."
                )}
              </Text>
            )}
            {draft.metadata === "replace" && (
              <>
                {draft.sources.map((citation, index) => (
                  <View key={citation.sourceKey} style={styles.form}>
                    <Text style={page.rowTitle}>
                      {t("Source {value1}", { value1: index + 1 })}
                    </Text>
                    {(
                      [
                        "path",
                        "revision",
                        "excerpt",
                      ] satisfies (keyof typeof citation)[]
                    ).map((field) => (
                      <TextInput
                        key={field}
                        accessibilityLabel={t("Source {value1} {value2}", {
                          value1: index + 1,
                          value2: field,
                        })}
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
                            ? t("knowledge/source.md")
                            : field === "revision"
                              ? t("Recorded source version")
                              : t("Exact supporting passage")
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
                    >
                      {t("Remove source {value1}", { value1: index + 1 })}
                    </ActionButton>
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
                  {t("Add cited source")}
                </ActionButton>
                <TextInput
                  accessibilityLabel={t("Valid from date")}
                  value={draft.from}
                  onChangeText={(from) => {
                    edit({ ...draft, from });
                  }}
                  placeholder={t("Valid from · YYYY-MM-DD, optional")}
                  maxLength={10}
                  autoCapitalize="none"
                  style={page.field}
                />
                <TextInput
                  accessibilityLabel={t("Exclusive valid until date")}
                  value={draft.until}
                  onChangeText={(until) => {
                    edit({ ...draft, until });
                  }}
                  placeholder={t("Until · YYYY-MM-DD, exclusive, optional")}
                  maxLength={10}
                  autoCapitalize="none"
                  style={page.field}
                />
                <Text style={page.copy}>
                  {t(
                    "Dates require cited evidence. An empty date stays unknown; the end date is exclusive."
                  )}
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
                    t(
                      "Check the value, exact source paths and revisions, cited passages and dates before reviewing."
                    )
                  );
                }
              }}
            >
              {t("Review change")}
            </ActionButton>
          </>
        ) : (
          <>
            <Text accessibilityRole="header" style={page.rowTitle}>
              {t("Your reviewed change")}
            </Text>
            <Text selectable style={page.copy}>
              {state.input.value === null
                ? t("Not established")
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
                ? t("Valid from {value1} · Until {value2} (exclusive)", {
                    value1: state.input.validTime.from ?? "unknown",
                    value2: state.input.validTime.until ?? "unknown",
                  })
                : t("World-valid dates not established")}
            </Text>
            <Text style={page.copy}>
              {t(
                "Publishing replaces this complete property claim. Sources are checked against current authorized files."
              )}
            </Text>
            {state.kind === "review" && (
              <>
                {needsConfirmation && (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={
                      draft.metadata === "clear"
                        ? t("Remove the current evidence and dates")
                        : t(
                            "I reviewed that this evidence supports the new value and dates"
                          )
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
                    >{`${confirmed ? "☑" : "☐"} ${draft.metadata === "clear" ? t("Remove the current evidence and dates") : t("I reviewed that this evidence supports the new value and dates")}`}</Text>
                  </Pressable>
                )}
                <ActionButton
                  disabled={needsConfirmation && !confirmed}
                  onPress={() => {
                    void send(state.input.operationId);
                  }}
                >
                  {t("Publish change")}
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
                  {t("Back to edit")}
                </ActionButton>
              </>
            )}
            {state.kind === "sending" && (
              <Text accessibilityLiveRegion="polite" style={page.copy}>
                {t("Publishing…")}
              </Text>
            )}
            {state.kind === "uncertain" && (
              <ActionButton
                onPress={() => {
                  void send(state.input.operationId);
                }}
              >
                {t("Retry this exact change")}
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
                  ? t("Loading current knowledge…")
                  : t("Review current knowledge")}
              </ActionButton>
            )}
            {state.kind === "comparison" && (
              <>
                <Text accessibilityRole="header" style={page.rowTitle}>
                  {t("Current published claim")}
                </Text>
                <Text style={page.copy}>
                  {t("Version {value1} · {value2}", {
                    value1: state.current.revision?.slice(0, 8) ?? "none",
                    value2:
                      currentClaim?.value === null || currentClaim === undefined
                        ? t("Not established")
                        : String(currentClaim.value),
                  })}
                </Text>
                {currentClaim && (
                  <OntologyEvidence
                    claim={currentClaim}
                    record={state.current}
                    data={data}
                  />
                )}
                <Text style={page.copy}>
                  {t(
                    "Your draft has not been rebased. Review this difference before using the current head; a new operation will be created."
                  )}
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
                        t(
                          "This action or its property changed. Discard this draft and reopen the current record."
                        )
                      );
                      return;
                    }
                    update({ kind: "editing", draft: rebased });
                    clearConfirmation();
                    setError(undefined);
                  }}
                >
                  {t("Use reviewed current head")}
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
          {t("Close")}
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

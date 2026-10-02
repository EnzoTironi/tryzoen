import { useI18n } from "./../i18n";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import type { LearnedClaimReadSchema } from "./schema";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import { isLearnedMemoryConflict, type LearnedNotesData } from "./data";
import { createLearnedClaimEdit } from "./draft";
import { LearnedClaimConflictReview } from "./editor";

const labels = {
  causes: "Causes",
  fixes: "Fixes",
  contradicts: "Contradicts",
} as const;
const summary = (text: string) => text.replace(/\s+/gu, " ").trim();

export function MemoryRelations({
  claimId,
  memory,
  data,
  onSaved,
  onClose,
}: {
  readonly claimId: string;
  readonly memory: z.output<typeof LearnedClaimReadSchema>;
  readonly data: Pick<LearnedNotesData, "change" | "read" | "newOperationId">;
  readonly onSaved: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const pageStyles = usePageStyles();
  const claim = memory.snapshot.claims.find((item) => item.file.id === claimId);
  const [draft, setDraft] = useState(() =>
    claim?.file.state.kind === "active"
      ? createLearnedClaimEdit(memory, data.newOperationId, claim)
      : undefined
  );
  const [review, setReview] =
    useState<z.output<typeof LearnedClaimReadSchema>>();
  const [kind, setKind] = useState<keyof typeof labels>("contradicts");
  const [query, setQuery] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error(t("This memory is no longer available."));
      await data.change(draft);
    },
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onError: async (error) => {
      if (isLearnedMemoryConflict(error)) setReview(await data.read());
      await onSaved();
    },
  });
  const documents = memory.snapshot.claims.flatMap((item) =>
    item.file.state.kind === "active"
      ? [{ id: item.file.id, body: item.file.state.body }]
      : []
  );
  const matches = documents.filter(
    (item) =>
      item.id !== claimId &&
      item.body.text.toLowerCase().includes(query.trim().toLowerCase())
  );
  if (review && draft)
    return (
      <LearnedClaimConflictReview
        draft={draft}
        current={review}
        edited="relations"
        newId={data.newOperationId}
        onReviewed={(next) => {
          setDraft(next);
          setReview(undefined);
          save.reset();
        }}
        onBack={() => {
          setReview(undefined);
        }}
      />
    );
  return (
    <CompanionSheet
      title={t("Memory relationships")}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    >
      <Text style={pageStyles.copy}>
        {t(
          "Private to you in this workspace. Relationship edits create a recorded version and preserve the reviewed text, evidence and world-valid dates."
        )}
      </Text>
      <Text selectable style={pageStyles.rowTitle}>
        {draft
          ? summary(draft.body.text)
          : t("This memory is no longer available.")}
      </Text>
      <View style={styles.group}>
        <Text style={pageStyles.rowTitle}>{t("This note…")}</Text>
        {!draft?.body.relations.length && (
          <Text style={pageStyles.copy}>{t("No relationships yet.")}</Text>
        )}
        {draft?.body.relations.map((relation) => (
          <View
            key={`${relation.kind}:${relation.claimId}`}
            style={styles.relation}
          >
            <Text style={pageStyles.copy}>
              {t(labels[relation.kind])}:{" "}
              {summary(
                documents.find((item) => item.id === relation.claimId)?.body
                  .text ?? t("Removed note")
              )}
            </Text>
            <ActionButton
              quiet
              disabled={save.isPending}
              onPress={() => {
                setDraft({
                  ...draft,
                  operationId: data.newOperationId(),
                  body: {
                    ...draft.body,
                    relations: draft.body.relations.filter(
                      (item) => item !== relation
                    ),
                  },
                });
              }}
            >
              {t("Remove relationship")}
            </ActionButton>
          </View>
        ))}
      </View>
      <View style={styles.actions}>
        {(["causes", "fixes", "contradicts"] as const).map((value) => (
          <ActionButton
            key={value}
            quiet={kind !== value}
            disabled={!draft || save.isPending}
            onPress={() => {
              setKind(value);
            }}
          >
            {t(labels[value])}
          </ActionButton>
        ))}
      </View>
      <TextInput
        accessibilityLabel={t("Find a memory to connect")}
        placeholder={t("Find a memory to connect")}
        value={query}
        onChangeText={setQuery}
        style={pageStyles.field}
        maxLength={8000}
      />
      <Text style={pageStyles.copy}>
        {t("Choose the other note. Up to 20 relationships per note.")}
      </Text>
      {matches.slice(0, 20).map((target) => (
        <View key={target.id} style={styles.relation}>
          <Text numberOfLines={3} style={pageStyles.copy}>
            {summary(target.body.text)}
          </Text>
          <ActionButton
            quiet
            disabled={
              !draft ||
              save.isPending ||
              draft.body.relations.length >= 20 ||
              draft.body.relations.some(
                (item) => item.kind === kind && item.claimId === target.id
              )
            }
            onPress={() => {
              if (draft)
                setDraft({
                  ...draft,
                  operationId: data.newOperationId(),
                  body: {
                    ...draft.body,
                    relations: [
                      ...draft.body.relations,
                      { kind, claimId: target.id },
                    ],
                  },
                });
            }}
          >
            {t("Connect note")}
          </ActionButton>
        </View>
      ))}
      {matches.length > 20 && (
        <Text style={pageStyles.copy}>
          {t(
            "Showing the first 20 matches. Refine your search to find another note."
          )}
        </Text>
      )}
      {!matches.length && (
        <Text style={pageStyles.copy}>{t("No other matching memories.")}</Text>
      )}
      {save.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {t(
            "The relationships could not be saved. Your full draft and original revision are retained. Review a newer revision explicitly before retrying a conflict."
          )}
        </Text>
      )}
      <View style={styles.actions}>
        <ActionButton
          disabled={!draft || save.isPending}
          onPress={() => {
            save.mutate();
          }}
        >
          {save.isPending ? t("Saving…") : t("Save relationships")}
        </ActionButton>
        <ActionButton quiet disabled={save.isPending} onPress={onClose}>
          {t("Discard relationship draft")}
        </ActionButton>
      </View>
    </CompanionSheet>
  );
}
const styles = StyleSheet.create({
  group: { gap: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  relation: { gap: 6, paddingVertical: 12 },
});

import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import type { LearnedClaimReadSchema } from "./schema";
import type { LearnedNotesData } from "./data";
import { isLearnedMemoryConflict } from "./data";
import {
  reviewLearnedClaimEdit,
  updateLearnedClaimText,
  type LearnedClaimEdit,
} from "./draft";
import { LearnedClaimProvenance } from "./provenance";
import { ActionButton } from "../button";
import { DocumentEditor } from "../document-editor";
import { CompanionSheet } from "../sheet";
import { usePageStyles } from "../page";

export function LearnedClaimConflictReview({
  draft,
  current,
  edited,
  newId,
  onReviewed,
  onBack,
}: {
  readonly draft: LearnedClaimEdit;
  readonly current: z.output<typeof LearnedClaimReadSchema>;
  readonly edited: "text" | "relations";
  readonly newId: () => string;
  readonly onReviewed: (draft: LearnedClaimEdit) => void;
  readonly onBack: () => void;
}) {
  const { t } = useI18n();
  const styles = usePageStyles();
  const claim = current.snapshot.claims.find(
    (item) => item.file.id === draft.claimId
  );
  const mayReview =
    (draft.action === "assert" && !claim) ||
    claim?.file.state.kind === "active";
  return (
    <CompanionSheet title={t("Review the newer memory")} onClose={onBack}>
      <View style={{ gap: 16 }}>
        <Text accessibilityRole="alert" style={styles.copy}>
          {t(
            "Someone changed this memory while you were editing. Your draft has been kept and has not overwritten that change."
          )}
        </Text>
        <Text accessibilityRole="header" style={styles.heading}>
          {t("Your draft")}
        </Text>
        <Text selectable style={styles.copy}>
          {draft.body.text}
        </Text>
        {edited === "relations" && (
          <>
            <Text style={styles.rowTitle}>{t("Draft relationships")}</Text>
            {!draft.body.relations.length && (
              <Text style={styles.copy}>{t("No relationships.")}</Text>
            )}
            {draft.body.relations.map((relation) => (
              <Text
                selectable
                key={`${relation.kind}:${relation.claimId}`}
                style={styles.copy}
              >
                {relation.kind} · {relation.claimId}
              </Text>
            ))}
          </>
        )}
        <Text accessibilityRole="header" style={styles.heading}>
          {t("Current saved memory")}
        </Text>
        {claim?.file.state.kind === "active" ? (
          <>
            <Text selectable style={styles.copy}>
              {claim.file.state.body.text}
            </Text>
            {edited === "relations" && (
              <>
                <Text style={styles.rowTitle}>
                  {t("Current relationships")}
                </Text>
                {!claim.file.state.body.relations.length && (
                  <Text style={styles.copy}>{t("No relationships.")}</Text>
                )}
                {claim.file.state.body.relations.map((relation) => (
                  <Text
                    selectable
                    key={`${relation.kind}:${relation.claimId}`}
                    style={styles.copy}
                  >
                    {relation.kind} · {relation.claimId}
                  </Text>
                ))}
              </>
            )}
            <LearnedClaimProvenance claim={claim} initiallyOpen />
          </>
        ) : (
          <Text style={styles.copy}>
            {draft.action === "assert"
              ? t("Other changes advanced the workspace memory revision.")
              : t("This memory was removed. A stale draft cannot restore it.")}
          </Text>
        )}
        <Text selectable style={styles.copy}>
          <Translated
            message="Current head: {value1}"
            values={{ value1: current.snapshot.revision ?? t("empty memory") }}
          />
        </Text>
        {mayReview && (
          <>
            {draft.action === "assert" &&
              claim?.file.state.kind === "active" && (
                <Text style={styles.copy}>
                  {t(
                    "This claim identity is already saved. Continuing after review makes a correction of this saved claim, not another assertion."
                  )}
                </Text>
              )}
            <Text style={styles.copy}>
              {edited === "text"
                ? t(
                    "After review, keep your draft text with the current saved evidence, dates and relationships."
                  )
                : t(
                    "After review, apply your drafted relationships while preserving the current text, evidence and dates."
                  )}
            </Text>
            <ActionButton
              onPress={() => {
                onReviewed(
                  reviewLearnedClaimEdit(draft, current, edited, newId)
                );
              }}
            >
              {t("Use this reviewed revision")}
            </ActionButton>
          </>
        )}
        <ActionButton quiet onPress={onBack}>
          {t("Keep editing the original draft")}
        </ActionButton>
      </View>
    </CompanionSheet>
  );
}

export function LearnedClaimEditor({
  initialDraft,
  data,
  onSaved,
  onClose,
}: {
  readonly initialDraft: LearnedClaimEdit;
  readonly data: Pick<LearnedNotesData, "change" | "read" | "newOperationId">;
  readonly onSaved: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initialDraft);
  const [review, setReview] =
    useState<z.output<typeof LearnedClaimReadSchema>>();
  const [reviewed, setReviewed] = useState(false);
  if (review)
    return (
      <LearnedClaimConflictReview
        draft={draft}
        current={review}
        edited="text"
        newId={data.newOperationId}
        onReviewed={(next) => {
          setDraft(next);
          setReviewed(true);
          setReview(undefined);
        }}
        onBack={() => {
          setReview(undefined);
        }}
      />
    );
  return (
    <DocumentEditor
      markdown
      title={t("Learned memory.md")}
      label={t("Learned memory")}
      description={t(
        "Edit the text. Saved evidence, world-valid dates and relationships are preserved. New notes have no cited evidence and unknown world-valid dates."
      )}
      initialText={draft.body.text}
      maxLength={8000}
      allowUnchanged={reviewed}
      initiallyDirty={draft.body.text !== initialDraft.body.text || reviewed}
      onClose={onClose}
      onSave={async (text) => {
        if (!text.trim()) throw new Error(t("Write a note before saving."));
        const command = updateLearnedClaimText(
          draft,
          text,
          data.newOperationId
        );
        setDraft(command);
        try {
          await data.change(command);
          await onSaved();
        } catch (error) {
          if (isLearnedMemoryConflict(error)) {
            setReview(await data.read());
            await onSaved();
          }
          throw error;
        }
      }}
    />
  );
}

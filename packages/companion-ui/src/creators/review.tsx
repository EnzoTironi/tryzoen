import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { DocumentEditor } from "../document-editor";
import { usePageStyles } from "../page";
import { useColors } from "../theme";
import {
  creatorPreviewReviewContentSchema,
  type creatorPreviewSchema,
} from "./schema";
import type { CreatorStudioData } from "./studio";

export const creatorReviewVerdicts = {
  useful: "Useful for this case",
  "needs-revision": "Needs revision",
  "unsafe-or-unsupported": "Unsafe or unsupported",
} as const;

const reviewDocuments = {
  criteria: {
    title: "Review criteria.md",
    label: "Review criteria",
    maxLength: 4000,
  },
  notes: { title: "Review notes.md", label: "Review notes", maxLength: 8000 },
  response: {
    title: "Preview response",
    label: "Saved specialist response",
    maxLength: 32000,
  },
} as const;

export function CreatorPreviewReview({
  preview,
  data,
  onClose,
}: {
  readonly preview: z.infer<typeof creatorPreviewSchema>;
  readonly data: Pick<CreatorStudioData, "reviewPreview">;
  readonly onClose: () => void;
}) {
  const { t, locale, errorText } = useI18n();
  const colors = useColors();
  const pageStyles = usePageStyles();
  const initial = preview.review?.content ?? {
    criteria: preview.evaluation?.case.criteria ?? "",
    notes: "",
    verdict: "needs-revision" as const,
  };
  const [value, setValue] = useState(initial);
  const [confirmed, setConfirmed] = useState(Boolean(preview.review));
  const [editing, setEditing] = useState<"criteria" | "notes" | "response">();
  const criteriaLocked = Boolean(preview.evaluation);
  const documentReadOnly =
    editing === "response" || (editing === "criteria" && criteriaLocked);
  const [discarding, setDiscarding] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      data.reviewPreview({
        id: preview.id,
        expectedRevision: preview.review?.revision ?? null,
        content: value,
      }),
    onSuccess: onClose,
  });
  const close = () => {
    if (save.isPending) return;
    if (JSON.stringify(initial) !== JSON.stringify(value)) setDiscarding(true);
    else onClose();
  };
  return (
    <CompanionSheet title={t("Your review")} onClose={close}>
      <Text style={pageStyles.rowTitle}>{preview.question}</Text>
      <Text style={pageStyles.copy}>
        {t(
          "Record what worked and what needs to change. Your review stays private with this saved response and playbook version."
        )}
      </Text>
      <ActionButton
        quiet
        disabled={save.isPending}
        onPress={() => {
          setEditing("response");
        }}
      >
        {t("Read saved response")}
      </ActionButton>
      <ActionButton
        quiet
        disabled={save.isPending}
        onPress={() => {
          setEditing("criteria");
        }}
      >
        {preview.evaluation
          ? t("Read predeclared criteria")
          : value.criteria
            ? t("Edit review criteria")
            : t("Write review criteria")}
      </ActionButton>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("Review verdict")}
        style={{ gap: 8 }}
      >
        {creatorPreviewReviewContentSchema.shape.verdict.options.map(
          (verdict) => (
            <Pressable
              key={verdict}
              accessibilityRole="radio"
              accessibilityLabel={t(creatorReviewVerdicts[verdict])}
              aria-checked={confirmed && value.verdict === verdict}
              aria-disabled={save.isPending}
              disabled={save.isPending}
              style={{
                minHeight: 44,
                flexDirection: "row",
                gap: 12,
                alignItems: "center",
                backgroundColor: colors.wash,
                padding: 12,
                borderRadius: 16,
              }}
              onPress={() => {
                setValue({ ...value, verdict });
                setConfirmed(true);
              }}
            >
              <Text style={pageStyles.rowTitle}>
                {confirmed && value.verdict === verdict ? "●" : "○"}
              </Text>
              <Text style={pageStyles.copy}>
                {t(creatorReviewVerdicts[verdict])}
              </Text>
            </Pressable>
          )
        )}
      </View>
      <ActionButton
        quiet
        disabled={save.isPending}
        onPress={() => {
          setEditing("notes");
        }}
      >
        {value.notes ? t("Edit review notes") : t("Write review notes")}
      </ActionButton>
      <Text style={pageStyles.copy}>
        {t("Explain which criteria the response met and what should improve.")}
      </Text>
      {preview.review && (
        <Text style={pageStyles.copy}>
          <Translated
            message="Last saved {value1} · {value2}"
            values={{
              value1: new Date(preview.review.updatedAt).toLocaleString(locale),
              value2: t(creatorReviewVerdicts[preview.review.content.verdict]),
            }}
          />
        </Text>
      )}
      <ActionButton
        disabled={
          save.isPending ||
          !confirmed ||
          !creatorPreviewReviewContentSchema.safeParse(value).success
        }
        onPress={() => {
          save.mutate();
        }}
      >
        {save.isPending ? t("Saving review…") : t("Save my review")}
      </ActionButton>
      {save.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          <Translated
            message="{value1} Your draft is still here."
            values={{ value1: errorText(save.error.message) }}
          />
        </Text>
      )}
      {discarding && (
        <View style={{ gap: 8 }}>
          <Text style={pageStyles.rowTitle}>
            {t("Discard your unsaved review?")}
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              setDiscarding(false);
            }}
          >
            {t("Keep editing")}
          </ActionButton>
          <ActionButton onPress={onClose}>{t("Discard changes")}</ActionButton>
        </View>
      )}
      {editing && (
        <DocumentEditor
          {...reviewDocuments[editing]}
          title={t(reviewDocuments[editing].title)}
          label={t(reviewDocuments[editing].label)}
          description={
            editing === "criteria" && criteriaLocked
              ? t(
                  "These criteria were saved before the model answered. This run keeps that original version."
                )
              : editing === "response"
                ? t(
                    "The original answer is read-only. Your review cannot alter it."
                  )
                : t(
                    "This editor updates your review draft. Use Save my review to save your criteria, verdict and notes together."
                  )
          }
          initialText={
            editing === "response" ? (preview.response ?? "") : value[editing]
          }
          markdown
          readOnly={documentReadOnly}
          onSave={async (text) => {
            if (!documentReadOnly) setValue({ ...value, [editing]: text });
          }}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </CompanionSheet>
  );
}

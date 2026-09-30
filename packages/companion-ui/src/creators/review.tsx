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
    <CompanionSheet title="Your review" onClose={close}>
      <Text style={pageStyles.rowTitle}>{preview.question}</Text>
      <Text style={pageStyles.copy}>
        Record what worked and what needs to change. Your review stays private
        with this saved response and playbook version.
      </Text>
      <ActionButton
        quiet
        disabled={save.isPending}
        onPress={() => {
          setEditing("response");
        }}
      >
        Read saved response
      </ActionButton>
      <ActionButton
        quiet
        disabled={save.isPending}
        onPress={() => {
          setEditing("criteria");
        }}
      >
        {preview.evaluation
          ? "Read predeclared criteria"
          : value.criteria
            ? "Edit review criteria"
            : "Write review criteria"}
      </ActionButton>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Review verdict"
        style={{ gap: 8 }}
      >
        {creatorPreviewReviewContentSchema.shape.verdict.options.map(
          (verdict) => (
            <Pressable
              key={verdict}
              accessibilityRole="radio"
              accessibilityLabel={creatorReviewVerdicts[verdict]}
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
                {creatorReviewVerdicts[verdict]}
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
        {value.notes ? "Edit review notes" : "Write review notes"}
      </ActionButton>
      <Text style={pageStyles.copy}>
        Explain which criteria the response met and what should improve.
      </Text>
      {preview.review && (
        <Text style={pageStyles.copy}>
          Last saved {new Date(preview.review.updatedAt).toLocaleString()} ·{" "}
          {creatorReviewVerdicts[preview.review.content.verdict]}
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
        {save.isPending ? "Saving review…" : "Save my review"}
      </ActionButton>
      {save.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {save.error.message} Your draft is still here.
        </Text>
      )}
      {discarding && (
        <View style={{ gap: 8 }}>
          <Text style={pageStyles.rowTitle}>Discard your unsaved review?</Text>
          <ActionButton
            quiet
            onPress={() => {
              setDiscarding(false);
            }}
          >
            Keep editing
          </ActionButton>
          <ActionButton onPress={onClose}>Discard changes</ActionButton>
        </View>
      )}
      {editing && (
        <DocumentEditor
          {...reviewDocuments[editing]}
          description={
            editing === "criteria" && criteriaLocked
              ? "These criteria were saved before the model answered. This run keeps that original version."
              : editing === "response"
                ? "The original answer is read-only. Your review cannot alter it."
                : "This editor updates your review draft. Use Save my review to save your criteria, verdict and notes together."
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

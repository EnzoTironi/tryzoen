import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { DocumentEditor } from "../document-editor";
import { usePageStyles } from "../page";
import { CreatorPreviewReview, creatorReviewVerdicts } from "./review";
import type { creatorDraftSchema, creatorPreviewSchema } from "./schema";
import type { CreatorStudioData } from "./studio";
import { CreatorPlaybookReview } from "./playbook-review";

const statusLabels = {
  pending: "Waiting to start…",
  running: "Generating…",
  completed: "Result saved",
  failed: "The model could not complete this request. Try a new request.",
  expired:
    "No response was saved before the five-minute deadline. Try a new preview.",
};

export function CreatorPreviewResult({
  preview,
  data,
  onRefresh,
  draft,
  onChanged,
}: {
  readonly preview: z.infer<typeof creatorPreviewSchema>;
  readonly data: CreatorStudioData;
  readonly onRefresh: () => Promise<unknown>;
  readonly draft?: z.infer<typeof creatorDraftSchema>;
  readonly onChanged?: (draft: z.infer<typeof creatorDraftSchema>) => void;
}) {
  const { t, locale } = useI18n();
  const pageStyles = usePageStyles();
  const [reading, setReading] = useState(false);
  // Capture the opening version so background refresh cannot replace an unsaved review.
  const [reviewing, setReviewing] =
    useState<z.infer<typeof creatorPreviewSchema>>();
  const download = useMutation({ mutationFn: data.exportPreview });
  const version = !draft
    ? t("Approved pilot version")
    : preview.revision === draft.revision
      ? t("Current saved version")
      : t("Earlier saved version");
  return (
    <View style={{ gap: 8, paddingVertical: 12 }}>
      {preview.kind === "playbook" && (
        <Text style={pageStyles.rowTitle}>{t("Playbook proposal")}</Text>
      )}
      {preview.evaluation && (
        <Text style={pageStyles.rowTitle}>
          {t("Evaluation: {value1}", { value1: preview.evaluation.case.title })}
        </Text>
      )}
      <Text style={pageStyles.rowTitle}>{preview.question}</Text>
      <Text accessibilityLiveRegion="polite" style={pageStyles.copy}>
        {t(statusLabels[preview.status])}
      </Text>
      <Text style={pageStyles.copy}>
        {new Date(preview.createdAt).toLocaleString(locale)} · {version}
      </Text>
      {preview.models.length > 0 && (
        <Text style={pageStyles.copy}>
          <Translated
            message="Model: {value1}"
            values={{
              value1: preview.models.map((model) => model.modelId).join(", "),
            }}
          />
        </Text>
      )}
      {preview.startedAt !== null && preview.finishedAt !== null && (
        <Text style={pageStyles.copy}>
          <Translated
            message="Execution time: {value1} s · from worker start to saved result"
            values={{
              value1: (
                (preview.finishedAt - preview.startedAt) /
                1000
              ).toLocaleString(locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }),
            }}
          />
        </Text>
      )}
      {preview.response !== null && (
        <>
          <ActionButton
            quiet
            onPress={() => {
              setReading(true);
            }}
          >
            {preview.kind === "playbook"
              ? t("Read proposal")
              : t("Read response")}
          </ActionButton>
          {preview.kind === "playbook" && draft && onChanged && (
            <CreatorPlaybookReview
              preview={preview}
              draft={draft}
              data={data}
              onChanged={onChanged}
            />
          )}
          <Text style={pageStyles.copy}>
            {preview.review
              ? t("Your review: {value1}", {
                  value1: t(
                    creatorReviewVerdicts[preview.review.content.verdict]
                  ),
                })
              : t("You have not reviewed this response yet.")}
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              setReviewing(preview);
            }}
          >
            {preview.review ? t("Edit my review") : t("Review response")}
          </ActionButton>
        </>
      )}
      <ActionButton
        quiet
        disabled={download.isPending}
        onPress={() => {
          download.mutate(preview.id);
        }}
      >
        {t("Export result and sources")}
      </ActionButton>
      {download.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {t("The preview could not be exported. Try again.")}
        </Text>
      )}
      {reading && preview.response && (
        <DocumentEditor
          title={t("Preview response")}
          label={t("Specialist preview response")}
          initialText={preview.response}
          maxLength={32000}
          description={t(
            "{value1}\n\nSaved {value2} · {value3}. This is a private preview, not a verified outcome.",
            {
              value1: preview.question,
              value2: new Date(preview.createdAt).toLocaleString(locale),
              value3: version,
            }
          )}
          markdown
          readOnly
          onSave={async () => {
            throw new Error(t("Preview results are read-only."));
          }}
          onClose={() => {
            setReading(false);
          }}
        />
      )}
      {reviewing && (
        <CreatorPreviewReview
          preview={reviewing}
          data={data}
          onClose={() => {
            setReviewing(undefined);
            void onRefresh();
          }}
        />
      )}
    </View>
  );
}

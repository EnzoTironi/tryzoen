import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { DocumentEditor } from "../document-editor";
import { pageStyles } from "../page";
import { CreatorPreviewReview, creatorReviewVerdicts } from "./review";
import type { creatorPreviewSchema } from "./schema";
import type { CreatorStudioData } from "./studio";

const statusLabels = {
  pending: "Waiting to start…",
  running: "Trying your playbook…",
  completed: "Response saved",
  failed: "The model could not complete this preview. Try a new preview.",
  expired:
    "No response was saved before the five-minute deadline. Try a new preview.",
};

export function CreatorPreviewResult({
  preview,
  currentRevision,
  data,
  onRefresh,
}: {
  readonly preview: z.infer<typeof creatorPreviewSchema>;
  readonly currentRevision: string;
  readonly data: CreatorStudioData;
  readonly onRefresh: () => Promise<unknown>;
}) {
  const [reading, setReading] = useState(false);
  // Capture the opening version so background refresh cannot replace an unsaved review.
  const [reviewing, setReviewing] =
    useState<z.infer<typeof creatorPreviewSchema>>();
  const download = useMutation({ mutationFn: data.exportPreview });
  const version =
    preview.revision === currentRevision
      ? "Current saved version"
      : "Earlier saved version";
  return (
    <View style={{ gap: 8, paddingVertical: 12 }}>
      <Text style={pageStyles.rowTitle}>{preview.question}</Text>
      <Text accessibilityLiveRegion="polite" style={pageStyles.copy}>
        {statusLabels[preview.status]}
      </Text>
      <Text style={pageStyles.copy}>
        {new Date(preview.createdAt).toLocaleString()} · {version}
      </Text>
      {preview.models.length > 0 && (
        <Text style={pageStyles.copy}>
          Model: {preview.models.map((model) => model.modelId).join(", ")}
        </Text>
      )}
      {preview.startedAt !== null && preview.finishedAt !== null && (
        <Text style={pageStyles.copy}>
          Execution time:{" "}
          {((preview.finishedAt - preview.startedAt) / 1000).toFixed(1)} s ·
          from worker start to saved result
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
            Read response
          </ActionButton>
          <Text style={pageStyles.copy}>
            {preview.review
              ? `Your review: ${creatorReviewVerdicts[preview.review.content.verdict]}`
              : "You have not reviewed this response yet."}
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              setReviewing(preview);
            }}
          >
            {preview.review ? "Edit my review" : "Review response"}
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
        Export preview and sources
      </ActionButton>
      {download.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          The preview could not be exported. Try again.
        </Text>
      )}
      {reading && preview.response && (
        <DocumentEditor
          title="Preview response"
          label="Specialist preview response"
          initialText={preview.response}
          maxLength={32000}
          description={`${preview.question}\n\nSaved ${new Date(preview.createdAt).toLocaleString()} · ${version}. This is a private preview, not a verified outcome.`}
          markdown
          readOnly
          onSave={async () => {
            throw new Error("Preview results are read-only.");
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

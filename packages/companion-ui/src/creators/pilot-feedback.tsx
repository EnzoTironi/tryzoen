import { useState } from "react";
import { Text } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { creatorPilotFeedbackViewSchema } from "./schema";
import type { CreatorStudioData } from "./studio";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { DocumentEditor } from "../document-editor";
import { pageStyles } from "../page";

export function CreatorPilotFeedback({
  id,
  data,
  cacheScope,
  onClose,
}: {
  readonly id: string;
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
  readonly onClose: () => void;
}) {
  const cache = useQueryClient();
  const queryKey = ["creator-pilot-feedback", cacheScope, id];
  const pilot = useQuery({ queryKey, queryFn: () => data.pilotFeedback(id) });
  // Freeze the opening revision; a background refresh cannot overwrite an edit.
  const [editing, setEditing] =
    useState<z.infer<typeof creatorPilotFeedbackViewSchema>>();
  const download = useMutation({ mutationFn: data.exportPilotFeedback });
  const shared = pilot.data;
  return (
    <CompanionSheet title="Feedback shared with creator" onClose={onClose}>
      {pilot.isPending && (
        <Text style={pageStyles.copy}>Loading feedback…</Text>
      )}
      {pilot.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          Shared feedback is unavailable. Check your connection and workspace
          access.
        </Text>
      )}
      <ActionButton
        quiet
        onPress={() => {
          void pilot.refetch();
        }}
      >
        Refresh shared feedback
      </ActionButton>
      {shared && (
        <>
          <Text style={pageStyles.rowTitle}>{shared.title}</Text>
          <Text style={pageStyles.copy}>Pilot status: {shared.status}</Text>
          <Text style={pageStyles.copy}>
            From {shared.recipientName} to {shared.creatorName}, about this
            approved version. Only the text explicitly submitted here is shared.
            Private questions, answers and reviews are never attached
            automatically.
          </Text>
          <Text style={pageStyles.copy}>
            Describe the context, what helped, what failed and the outcome you
            actually observed. Separate observations from assumptions and leave
            out other people’s private details. Up to 16,000 characters.
          </Text>
          <Text style={pageStyles.copy}>
            The participant can update this report while the pilot is active.
            Submitted feedback stays readable by both people after the pilot
            ends, while both remain in this workspace. Copies already read or
            exported cannot be recalled.
          </Text>
          {shared.feedback ? (
            <Text style={pageStyles.copy}>
              Submitted {new Date(shared.feedback.updatedAt).toLocaleString()}
            </Text>
          ) : (
            <Text style={pageStyles.copy}>No feedback has been submitted.</Text>
          )}
          {(shared.feedback !== null ||
            (!shared.isCreator && shared.status === "active")) && (
            <ActionButton
              disabled={pilot.isError || pilot.isFetching}
              onPress={() => {
                setEditing(shared);
              }}
            >
              {shared.isCreator || shared.status !== "active"
                ? "Read submitted feedback"
                : shared.feedback
                  ? "Edit feedback for creator"
                  : "Write feedback for creator"}
            </ActionButton>
          )}
          {shared.feedback && (
            <ActionButton
              quiet
              disabled={pilot.isError || pilot.isFetching || download.isPending}
              onPress={() => {
                download.mutate(id);
              }}
            >
              Export submitted feedback
            </ActionButton>
          )}
          {download.error && (
            <Text accessibilityRole="alert" style={pageStyles.copy}>
              {download.error.message}
            </Text>
          )}
        </>
      )}
      {editing && (
        <DocumentEditor
          title="Pilot feedback.md"
          label="Feedback for creator"
          description={
            editing.isCreator || editing.status !== "active"
              ? `Submitted by ${editing.recipientName} to ${editing.creatorName}. This report is read-only. Private questions, answers and reviews are not attached.`
              : `Only this text will be shared with ${editing.creatorName}. Your private questions, answers and reviews are not attached. Check your observations and permission to share before submitting.`
          }
          initialText={editing.feedback?.content ?? ""}
          maxLength={16000}
          markdown
          readOnly={editing.isCreator || editing.status !== "active"}
          saveLabel={`Share with ${editing.creatorName}`}
          onClose={() => {
            setEditing(undefined);
          }}
          onSave={async (content) => {
            if (editing.isCreator || editing.status !== "active") return;
            if (!content.trim())
              throw new Error("Write your feedback before sharing.");
            const saved = await data.savePilotFeedback({
              id,
              expectedRevision: editing.feedback?.revision ?? null,
              content,
              shareWithCreator: true,
            });
            cache.setQueryData(queryKey, saved);
          }}
        />
      )}
    </CompanionSheet>
  );
}

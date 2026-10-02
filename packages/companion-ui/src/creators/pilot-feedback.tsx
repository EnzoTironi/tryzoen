import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import { Text } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { creatorPilotFeedbackViewSchema } from "./schema";
import type { CreatorStudioData } from "./studio";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { DocumentEditor } from "../document-editor";
import { usePageStyles } from "../page";

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
  const { t, locale, errorText } = useI18n();
  const pageStyles = usePageStyles();
  const cache = useQueryClient();
  const queryKey = ["creator-pilot-feedback", cacheScope, id];
  const pilot = useQuery({ queryKey, queryFn: () => data.pilotFeedback(id) });
  // Freeze the opening revision; a background refresh cannot overwrite an edit.
  const [editing, setEditing] =
    useState<z.infer<typeof creatorPilotFeedbackViewSchema>>();
  const download = useMutation({ mutationFn: data.exportPilotFeedback });
  const shared = pilot.data;
  return (
    <CompanionSheet title={t("Feedback shared with creator")} onClose={onClose}>
      {pilot.isPending && (
        <Text style={pageStyles.copy}>{t("Loading feedback…")}</Text>
      )}
      {pilot.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {t(
            "Shared feedback is unavailable. Check your connection and workspace access."
          )}
        </Text>
      )}
      <ActionButton
        quiet
        onPress={() => {
          void pilot.refetch();
        }}
      >
        {t("Refresh shared feedback")}
      </ActionButton>
      {shared && (
        <>
          <Text style={pageStyles.rowTitle}>{shared.title}</Text>
          <Text style={pageStyles.copy}>
            <Translated
              message="Pilot status: {value1}"
              values={{ value1: t(shared.status) }}
            />
          </Text>
          <Text style={pageStyles.copy}>
            <Translated
              message="From {value1} to {value2}, about this approved version. Only the text explicitly submitted here is shared. Private questions, answers and reviews are never attached automatically."
              values={{
                value1: shared.recipientName,
                value2: shared.creatorName,
              }}
            />
          </Text>
          <Text style={pageStyles.copy}>
            {t(
              "Describe the context, what helped, what failed and the outcome you actually observed. Separate observations from assumptions and leave out other people’s private details. Up to 16,000 characters."
            )}
          </Text>
          <Text style={pageStyles.copy}>
            {t(
              "The participant can update this report while the pilot is active. Submitted feedback stays readable by both people after the pilot ends, while both remain in this workspace. Copies already read or exported cannot be recalled."
            )}
          </Text>
          {shared.feedback ? (
            <Text style={pageStyles.copy}>
              <Translated
                message="Submitted {value1}"
                values={{
                  value1: new Date(shared.feedback.updatedAt).toLocaleString(
                    locale
                  ),
                }}
              />
            </Text>
          ) : (
            <Text style={pageStyles.copy}>
              {t("No feedback has been submitted.")}
            </Text>
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
                ? t("Read submitted feedback")
                : shared.feedback
                  ? t("Edit feedback for creator")
                  : t("Write feedback for creator")}
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
              {t("Export submitted feedback")}
            </ActionButton>
          )}
          {download.error && (
            <Text accessibilityRole="alert" style={pageStyles.copy}>
              {errorText(download.error.message)}
            </Text>
          )}
        </>
      )}
      {editing && (
        <DocumentEditor
          title={t("Pilot feedback.md")}
          label={t("Feedback for creator")}
          description={
            editing.isCreator || editing.status !== "active"
              ? t(
                  "Submitted by {value1} to {value2}. This report is read-only. Private questions, answers and reviews are not attached.",
                  { value1: editing.recipientName, value2: editing.creatorName }
                )
              : t(
                  "Only this text will be shared with {value1}. Your private questions, answers and reviews are not attached. Check your observations and permission to share before submitting.",
                  { value1: editing.creatorName }
                )
          }
          initialText={editing.feedback?.content ?? ""}
          maxLength={16000}
          markdown
          readOnly={editing.isCreator || editing.status !== "active"}
          saveLabel={t("Share with {name}", { name: editing.creatorName })}
          onClose={() => {
            setEditing(undefined);
          }}
          onSave={async (content) => {
            if (editing.isCreator || editing.status !== "active") return;
            if (!content.trim())
              throw new Error(t("Write your feedback before sharing."));
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

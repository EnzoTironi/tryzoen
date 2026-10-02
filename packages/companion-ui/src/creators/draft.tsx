import { useI18n } from "./../i18n";
import { useState } from "react";
import { Text } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { DocumentEditor } from "../document-editor";
import { usePageStyles } from "../page";
import type { CreatorStudioData } from "./studio";
import { CreatorExamples } from "./examples";
import { CreatorDraftActions } from "./actions";
import { CreatorDetails } from "./details";
import { CreatorEvaluation } from "./evaluation";
import { CreatorPreviews } from "./previews";
import { CreatorReleases } from "./releases";
import type { creatorDraftSchema } from "./schema";

export function CreatorDraft({
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
  const { t } = useI18n();
  const pageStyles = usePageStyles();
  const client = useQueryClient();
  const queryKey = ["creator-draft", cacheScope, id];
  const draft = useQuery({ queryKey, queryFn: () => data.read(id) });
  const [playbook, setPlaybook] =
    useState<z.infer<typeof creatorDraftSchema>>();
  const [details, setDetails] = useState<z.infer<typeof creatorDraftSchema>>();
  const [evaluation, setEvaluation] = useState(false);
  const [preview, setPreview] = useState(false);
  const [releases, setReleases] = useState(false);
  return (
    <CompanionSheet
      title={draft.data?.content.title ?? t("Specialist draft")}
      onClose={onClose}
    >
      {draft.isPending && (
        <Text style={pageStyles.copy}>{t("Loading your specialist…")}</Text>
      )}
      {draft.isError && (
        <>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            {t(
              "This draft is unavailable. Check your workspace and try again."
            )}
          </Text>
          <ActionButton
            onPress={() => {
              void draft.refetch();
            }}
          >
            {t("Try again")}
          </ActionButton>
        </>
      )}
      {draft.data && !draft.isError && (
        <>
          <Text style={pageStyles.copy}>
            {draft.data.archivedAt
              ? t("Archived draft · Restore it to make changes.")
              : t(
                  "Private draft · Only you can open this draft. Sharing an approved version requires a separate pilot invitation."
                )}
          </Text>
          {Boolean(draft.data.content.description) && (
            <Text style={pageStyles.copy}>
              {draft.data.content.description}
            </Text>
          )}
          <CreatorDraftActions
            draft={draft.data}
            data={data}
            onChanged={(updated) => {
              client.setQueryData(queryKey, updated);
            }}
          />
          <ActionButton
            quiet
            onPress={() => {
              setPreview(true);
            }}
          >
            {draft.data.archivedAt
              ? t("Saved previews")
              : t("Try this specialist")}
          </ActionButton>
          <ActionButton
            quiet
            onPress={() => {
              setEvaluation(true);
            }}
          >
            {t("Evaluation cases")}
          </ActionButton>
          <ActionButton
            quiet
            onPress={() => {
              setReleases(true);
            }}
          >
            {t("Approved versions")}
          </ActionButton>
          {!draft.data.archivedAt && (
            <ActionButton
              quiet
              onPress={() => {
                setDetails(draft.data);
              }}
            >
              {t("Edit specialist details")}
            </ActionButton>
          )}
          <Text
            accessibilityRole="header"
            style={[pageStyles.heading, { marginBottom: 0 }]}
          >
            {t("Playbook")}
          </Text>
          <Text style={pageStyles.copy}>
            {t(
              "Define useful strategies, the context they need and when a person should take over."
            )}
          </Text>
          <ActionButton
            onPress={() => {
              setPlaybook(draft.data);
            }}
          >
            {draft.data.archivedAt ? t("Read playbook") : t("Edit playbook")}
          </ActionButton>
          <CreatorExamples
            draft={draft.data}
            data={data}
            onChanged={(updated) => {
              client.setQueryData(queryKey, updated);
            }}
          />
        </>
      )}
      {playbook && (
        <DocumentEditor
          title={t("Playbook.md")}
          label={t("Specialist playbook")}
          description={t(
            "Your private draft. Saving does not publish this playbook or change an active agent."
          )}
          initialText={playbook.content.playbook}
          maxLength={64000}
          markdown
          readOnly={Boolean(playbook.archivedAt)}
          onClose={() => {
            setPlaybook(undefined);
          }}
          onSave={async (text) => {
            const updated = await data.save({
              id,
              expectedRevision: playbook.revision,
              content: { ...playbook.content, playbook: text },
            });
            client.setQueryData(queryKey, updated);
          }}
        />
      )}
      {details && (
        <CreatorDetails
          draft={details}
          save={data.save}
          onSaved={(updated) => {
            client.setQueryData(queryKey, updated);
          }}
          onClose={() => {
            setDetails(undefined);
          }}
        />
      )}
      {evaluation && draft.data && !draft.isError && (
        <CreatorEvaluation
          draft={draft.data}
          data={data}
          onChanged={(updated) => {
            client.setQueryData(queryKey, updated);
          }}
          onClose={() => {
            setEvaluation(false);
          }}
        />
      )}
      {preview && draft.data && !draft.isError && (
        <CreatorPreviews
          draft={draft.data}
          data={data}
          cacheScope={cacheScope}
          onChanged={(updated) => {
            client.setQueryData(queryKey, updated);
          }}
          onClose={() => {
            setPreview(false);
          }}
        />
      )}
      {releases && draft.data && !draft.isError && (
        <CreatorReleases
          draftId={id}
          data={data}
          cacheScope={cacheScope}
          archived={Boolean(draft.data.archivedAt)}
          onClose={() => {
            setReleases(false);
          }}
        />
      )}
    </CompanionSheet>
  );
}

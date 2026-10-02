import { useI18n } from "./../i18n";
import { useState } from "react";
import { Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { CreatorStudioData } from "./studio";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { DocumentEditor } from "../document-editor";
import { usePageStyles } from "../page";
import { CreatorReleaseEvidence } from "./release-evidence";

export function CreatorReleaseReview({
  draftId,
  data,
  cacheScope,
  onApproved,
  onClose,
}: {
  readonly draftId: string;
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
  readonly onApproved: (id: string) => void;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const pageStyles = usePageStyles();
  const [id] = useState(data.newId);
  const [approving, setApproving] = useState(false);
  const candidate = useQuery({
    queryKey: ["creator-release-candidate", cacheScope, draftId, id],
    queryFn: () => data.releaseCandidate(draftId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return (
    <CompanionSheet title={t("Review this version")} onClose={onClose}>
      <Text style={pageStyles.copy}>
        {t(
          "Review the exact playbook, sources and case results. Approval saves a private version that later draft edits cannot change. It does not publish your specialist or certify expertise."
        )}
      </Text>
      {candidate.isPending && (
        <Text style={pageStyles.copy}>{t("Loading this version…")}</Text>
      )}
      {candidate.isError && (
        <>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            {t("This version could not be loaded.")}
          </Text>
          <ActionButton
            onPress={() => {
              void candidate.refetch();
            }}
          >
            {t("Try again")}
          </ActionButton>
        </>
      )}
      {candidate.data && !candidate.isError && (
        <>
          <CreatorReleaseEvidence
            content={candidate.data.draft.content}
            evidence={candidate.data.evidence}
          />
          {candidate.data.issues.map((issue) => (
            <Text key={issue} accessibilityRole="alert" style={pageStyles.copy}>
              {issue}
            </Text>
          ))}
          <ActionButton
            disabled={candidate.data.issues.length > 0}
            onPress={() => {
              setApproving(true);
            }}
          >
            {t("Write approval notes")}
          </ActionButton>
        </>
      )}
      {approving && candidate.data?.draft.evaluation && (
        <DocumentEditor
          title={t("Approval notes.md")}
          label={t("Approval notes")}
          markdown
          initialText=""
          maxLength={8000}
          saveLabel={t("Approve private version")}
          description={t(
            "Record why these cases support this version, its limitations and what still needs a pilot. Saving confirms your review and preserves a private copy."
          )}
          onClose={() => {
            setApproving(false);
          }}
          onSave={async (notes) => {
            const value = candidate.data;
            if (!value.draft.evaluation || value.issues.length)
              throw new Error(
                t("Reopen the version review before approving it.")
              );
            const saved = await data.approveRelease({
              id,
              draftId,
              revision: value.draft.revision,
              evaluationRevision: value.draft.evaluation.revision,
              evidence: value.evidence.map((item) => ({
                id: item.id,
                reviewRevision: item.review.revision,
              })),
              notes,
            });
            onApproved(saved.id);
          }}
        />
      )}
    </CompanionSheet>
  );
}

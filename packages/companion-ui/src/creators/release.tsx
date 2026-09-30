import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text } from "react-native";
import type { CreatorStudioData } from "./studio";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import { CreatorReleaseEvidence } from "./release-evidence";
import { DocumentEditor } from "../document-editor";
import { CreatorPilotInvite } from "./pilot-invite";

export function CreatorRelease({
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
  const pageStyles = usePageStyles();
  const release = useQuery({
    queryKey: ["creator-release", cacheScope, id],
    queryFn: () => data.release(id),
  });
  const download = useMutation({ mutationFn: () => data.exportRelease(id) });
  const [readingNotes, setReadingNotes] = useState(false);
  const [inviting, setInviting] = useState(false);
  return (
    <CompanionSheet title="Approved private version" onClose={onClose}>
      {release.isPending && (
        <Text style={pageStyles.copy}>Loading approved version…</Text>
      )}
      {release.isError && (
        <>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            This version is unavailable.
          </Text>
          <ActionButton
            onPress={() => {
              void release.refetch();
            }}
          >
            Try again
          </ActionButton>
        </>
      )}
      {release.data && !release.isError && (
        <>
          <Text style={pageStyles.copy}>
            Approved {new Date(release.data.createdAt).toLocaleString()} ·
            Private
          </Text>
          <Text style={pageStyles.copy}>
            This saved version stays unchanged when you edit the draft or its
            reviews. It has not been published.
          </Text>
          <CreatorReleaseEvidence
            content={release.data.content}
            evidence={release.data.evidence}
          />
          <ActionButton
            quiet
            onPress={() => {
              setInviting(true);
            }}
          >
            Invite to a private pilot
          </ActionButton>
          <Text accessibilityRole="header" style={pageStyles.heading}>
            Approval notes
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              setReadingNotes(true);
            }}
          >
            Read approval notes
          </ActionButton>
          <ActionButton
            disabled={download.isPending}
            onPress={() => {
              download.mutate();
            }}
          >
            Export approved version
          </ActionButton>
          {download.isError && (
            <Text accessibilityRole="alert" style={pageStyles.copy}>
              The export failed. Your approved version is still saved.
            </Text>
          )}
        </>
      )}
      {readingNotes && release.data && (
        <DocumentEditor
          title="Approval notes.md"
          label="Saved approval notes"
          description="The creator's review recorded when this private version was approved."
          initialText={release.data.notes}
          maxLength={8000}
          markdown
          readOnly
          onClose={() => {
            setReadingNotes(false);
          }}
          onSave={async () => {
            throw new Error("Approved versions cannot be edited.");
          }}
        />
      )}
      {inviting && release.data && !release.isError && (
        <CreatorPilotInvite
          release={release.data}
          data={data}
          onClose={() => {
            setInviting(false);
          }}
        />
      )}
    </CompanionSheet>
  );
}

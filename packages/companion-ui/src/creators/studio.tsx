import { useState } from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { pageStyles } from "../page";
import { CreatorDraftCreate } from "./create";
import { CreatorDraft } from "./draft";
import { CreatorPilots } from "./pilots";
import type {
  creatorEvaluationSaveSchema,
  creatorDraftListSchema,
  creatorDraftSaveSchema,
  creatorDraftSchema,
  creatorDraftStateSchema,
  creatorPreviewRequestSchema,
  creatorPreviewListSchema,
  creatorPreviewReviewSaveSchema,
  creatorPreviewReviewSchema,
  creatorReleaseCandidateSchema,
  creatorReleaseListSchema,
  creatorReleaseRequestSchema,
  creatorReleaseSchema,
  creatorPilotInviteSchema,
  creatorPilotActionSchema,
  creatorPilotSchema,
  creatorPilotListSchema,
  creatorPilotTeachingSchema,
  creatorPilotFeedbackViewSchema,
  creatorPilotFeedbackSaveSchema,
} from "./schema";

export interface CreatorStudioData {
  pilotFeedback: (
    id: string
  ) => Promise<z.infer<typeof creatorPilotFeedbackViewSchema>>;
  savePilotFeedback: (
    input: z.infer<typeof creatorPilotFeedbackSaveSchema>
  ) => Promise<z.infer<typeof creatorPilotFeedbackViewSchema>>;
  exportPilotFeedback: (id: string) => Promise<void>;
  pilots: () => Promise<z.infer<typeof creatorPilotListSchema>>;
  pilot: (id: string) => Promise<z.infer<typeof creatorPilotTeachingSchema>>;
  invitePilot: (
    input: z.infer<typeof creatorPilotInviteSchema>
  ) => Promise<z.infer<typeof creatorPilotTeachingSchema>>;
  actOnPilot: (
    input: z.infer<typeof creatorPilotActionSchema>
  ) => Promise<z.infer<typeof creatorPilotSchema>>;
  releaseCandidate: (
    draftId: string
  ) => Promise<z.infer<typeof creatorReleaseCandidateSchema>>;
  approveRelease: (
    input: z.infer<typeof creatorReleaseRequestSchema>
  ) => Promise<z.infer<typeof creatorReleaseSchema>>;
  releases: (
    draftId: string
  ) => Promise<z.infer<typeof creatorReleaseListSchema>>;
  release: (id: string) => Promise<z.infer<typeof creatorReleaseSchema>>;
  exportRelease: (id: string) => Promise<void>;
  saveEvaluation: (
    input: z.infer<typeof creatorEvaluationSaveSchema>
  ) => Promise<z.infer<typeof creatorDraftSchema>>;
  list: () => Promise<z.infer<typeof creatorDraftListSchema>>;
  read: (id: string) => Promise<z.infer<typeof creatorDraftSchema>>;
  save: (
    input: z.infer<typeof creatorDraftSaveSchema>
  ) => Promise<z.infer<typeof creatorDraftSchema>>;
  archive: (
    input: z.infer<typeof creatorDraftStateSchema>
  ) => Promise<z.infer<typeof creatorDraftSchema>>;
  exportDraft: (id: string) => Promise<void>;
  exportPreview: (id: string) => Promise<void>;
  reviewPreview: (
    input: z.infer<typeof creatorPreviewReviewSaveSchema>
  ) => Promise<z.infer<typeof creatorPreviewReviewSchema>>;
  preview: (
    input: z.infer<typeof creatorPreviewRequestSchema>
  ) => Promise<void>;
  previews: (
    draftId: string,
    pilotId?: string
  ) => Promise<z.infer<typeof creatorPreviewListSchema>>;
  newId: () => string;
}

export function CreatorStudio({
  data,
  cacheScope,
}: {
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton
        quiet
        onPress={() => {
          setOpen(true);
        }}
      >
        Creator studio
      </ActionButton>
      {open && (
        <StudioDrafts
          data={data}
          cacheScope={cacheScope}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function StudioDrafts({
  data,
  cacheScope,
  onClose,
}: {
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
  readonly onClose: () => void;
}) {
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<string>();
  const drafts = useQuery({
    queryKey: ["creator-drafts", cacheScope],
    queryFn: data.list,
  });
  return (
    <CompanionSheet title="Creator studio" onClose={onClose}>
      <Text style={pageStyles.copy}>
        Turn your expertise into an AI playbook. Start with examples you have
        permission to use, then review your strategies and limits.
      </Text>
      <Text style={pageStyles.copy}>
        Drafts and approval records stay private. You can share selected
        teaching from an approved version with a named person in this workspace
        for a pilot. Public publishing is not available yet.
      </Text>
      <CreatorPilots data={data} cacheScope={cacheScope} />
      {!archived && (
        <CreatorDraftCreate
          data={data}
          disabled={
            !drafts.data ||
            drafts.isError ||
            drafts.data.filter((item) => !item.archivedAt).length >= 20 ||
            drafts.data.length >= 100
          }
          onCreated={setSelected}
          onRefresh={drafts.refetch}
        />
      )}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <ActionButton
          quiet={archived}
          onPress={() => {
            setArchived(false);
          }}
        >
          Active drafts
        </ActionButton>
        <ActionButton
          quiet={!archived}
          onPress={() => {
            setArchived(true);
          }}
        >
          Archived drafts
        </ActionButton>
      </View>
      <Text style={pageStyles.copy}>
        Up to 20 active drafts and 100 total drafts per workspace. Archived
        drafts are kept for you to read, export or restore.
      </Text>
      {drafts.isPending && (
        <Text style={pageStyles.copy}>Loading your drafts…</Text>
      )}
      {drafts.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          Your drafts could not be loaded. Try again.
        </Text>
      )}
      {drafts.isError && (
        <ActionButton
          quiet
          onPress={() => {
            void drafts.refetch();
          }}
        >
          Try again
        </ActionButton>
      )}
      {drafts.data?.filter((item) => Boolean(item.archivedAt) === archived)
        .length === 0 && (
        <Text style={pageStyles.copy}>
          {archived
            ? "No archived drafts yet."
            : "Your first specialist starts here."}
        </Text>
      )}
      {!drafts.isError &&
        drafts.data
          ?.filter((item) => Boolean(item.archivedAt) === archived)
          .map((draft) => (
            <View key={draft.id} style={{ gap: 8, paddingVertical: 12 }}>
              <Text style={pageStyles.rowTitle}>{draft.title}</Text>
              <Text style={pageStyles.copy}>
                {draft.examples} authored examples ·{" "}
                {draft.archivedAt ? "Archived" : "Private draft"}
              </Text>
              <ActionButton
                quiet
                onPress={() => {
                  setSelected(draft.id);
                }}
              >
                {`Open ${draft.title}`}
              </ActionButton>
            </View>
          ))}
      {selected && (
        <CreatorDraft
          key={selected}
          id={selected}
          data={data}
          cacheScope={cacheScope}
          onClose={() => {
            setSelected(undefined);
            void drafts.refetch();
          }}
        />
      )}
    </CompanionSheet>
  );
}

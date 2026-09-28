import { useRef, useState } from "react";
import { Text, TextInput } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import type { creatorPilotTeachingSchema } from "./schema";
import type { CreatorStudioData } from "./studio";
import { CreatorReleaseEvidence } from "./release-evidence";
import { CreatorPreviewResult } from "./preview-result";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { pageStyles } from "../page";

export function CreatorPilot({
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
  const pilot = useQuery({
    queryKey: ["creator-pilot", cacheScope, id],
    queryFn: () => data.pilot(id),
    refetchInterval: 5000,
    retry: false,
  });
  return (
    <CompanionSheet title="Private AI pilot" onClose={onClose}>
      {pilot.isPending && (
        <Text style={pageStyles.copy}>Loading shared teaching…</Text>
      )}
      {pilot.isError && (
        <>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            This pilot is unavailable. Access may have ended, or your connection
            may be interrupted. Your unsaved question and previously loaded
            content are kept on this device.
          </Text>
          <ActionButton
            onPress={() => {
              void pilot.refetch();
            }}
          >
            Try again
          </ActionButton>
        </>
      )}
      {pilot.data && (
        <PilotQuestions
          available={!pilot.isError}
          pilot={pilot.data}
          data={data}
          cacheScope={cacheScope}
        />
      )}
    </CompanionSheet>
  );
}

function PilotQuestions({
  available,
  pilot,
  data,
  cacheScope,
}: {
  readonly available: boolean;
  readonly pilot: z.infer<typeof creatorPilotTeachingSchema>;
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
}) {
  const [question, setQuestion] = useState("");
  const requestId = useRef<string | undefined>(undefined);
  const previews = useQuery({
    queryKey: ["creator-pilot-previews", cacheScope, pilot.id],
    queryFn: () => data.previews(pilot.draftId, pilot.id),
    refetchInterval: (query) =>
      query.state.data?.some(
        (item) => item.status === "pending" || item.status === "running"
      )
        ? 3000
        : false,
  });
  const run = useMutation({
    mutationFn: () => {
      requestId.current ??= data.newId();
      return data.preview({
        id: requestId.current,
        pilotId: pilot.id,
        draftId: pilot.draftId,
        revision: pilot.revision,
        kind: "answer",
        question,
      });
    },
    onSuccess: () => {
      setQuestion("");
      requestId.current = undefined;
    },
    onSettled: () => {
      void previews.refetch();
    },
  });
  const active = previews.data?.some(
    (item) => item.status === "pending" || item.status === "running"
  );
  return (
    <>
      <Text style={pageStyles.copy}>
        AI based on selected teaching from {pilot.creatorName}. This is not the
        creator speaking, and approval is not proof of expertise.
      </Text>
      <CreatorReleaseEvidence content={pilot.content} />
      <Text style={pageStyles.copy}>
        Only this approved teaching and your question reach your selected model.
        Personal memory, conversation history and tools are excluded. The
        creator cannot read your questions, answers or private reviews. Share
        only information you have permission to send to your model.
      </Text>
      <Text style={pageStyles.copy}>
        One request at a time, up to 10 in 24 hours and 100 saved results per
        person in this workspace, shared with your own previews and proposals.
        Latest 20 results shown.
      </Text>
      <TextInput
        accessibilityLabel="Pilot question"
        multiline
        maxLength={4000}
        value={question}
        editable={!run.isPending}
        style={[pageStyles.field, { minHeight: 120 }]}
        onChangeText={(value) => {
          setQuestion(value);
          requestId.current = undefined;
        }}
      />
      <ActionButton
        disabled={
          !available ||
          !question.trim() ||
          run.isPending ||
          previews.isPending ||
          previews.isError ||
          Boolean(active)
        }
        onPress={() => {
          run.mutate();
        }}
      >
        {run.isPending ? "Starting…" : "Ask privately"}
      </ActionButton>
      {run.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {run.error.message} Any accepted request will appear below.
        </Text>
      )}
      {previews.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          Saved results are unavailable. Refresh to check your access and
          connection.
        </Text>
      )}
      <ActionButton
        quiet
        onPress={() => {
          void previews.refetch();
        }}
      >
        Refresh results
      </ActionButton>
      {previews.data?.map((preview) => (
        <CreatorPreviewResult
          key={preview.id}
          preview={preview}
          data={data}
          onRefresh={previews.refetch}
        />
      ))}
    </>
  );
}

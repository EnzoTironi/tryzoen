import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { DocumentEditor } from "../document-editor";
import { pageStyles } from "../page";
import type { creatorDraftSchema, creatorPreviewSchema } from "./schema";
import type { CreatorStudioData } from "./studio";

const statusLabels = {
  pending: "Waiting to start…",
  running: "Trying your playbook…",
  completed: "Response saved",
  failed: "The model could not complete this preview. Try a new preview.",
  expired:
    "No response was saved before the five-minute deadline. Try a new preview.",
};

export function CreatorPreviews({
  draft,
  data,
  cacheScope,
  onClose,
}: {
  readonly draft: z.infer<typeof creatorDraftSchema>;
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
  readonly onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [selected, setSelected] =
    useState<z.infer<typeof creatorPreviewSchema>>();
  const requestId = useRef<string | undefined>(undefined);
  const download = useMutation({ mutationFn: data.exportPreview });
  const previews = useQuery({
    queryKey: ["creator-previews", cacheScope, draft.id],
    queryFn: () => data.previews(draft.id),
    refetchInterval: (query) =>
      query.state.data?.some(
        (item) => item.status === "pending" || item.status === "running"
      )
        ? 3000
        : false,
  });
  const mutation = useMutation({
    mutationFn: () => {
      requestId.current ??= data.newId();
      return data.preview({
        id: requestId.current,
        draftId: draft.id,
        revision: draft.revision,
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
    <CompanionSheet title="Try your specialist" onClose={onClose}>
      <Text style={pageStyles.copy}>
        Ask a fictional test question. The specialist receives this saved
        playbook and its examples, with no personal memory, conversation history
        or tools. Your selected model is used.
      </Text>
      <Text style={pageStyles.copy}>
        Responses are private previews, not release evaluations. Review the
        answer yourself. Up to 10 previews in 24 hours and 100 saved previews
        per workspace; the latest 20 for this draft appear here.
      </Text>
      {!draft.archivedAt && (
        <>
          <TextInput
            accessibilityLabel="Preview question"
            multiline
            maxLength={4000}
            value={question}
            editable={!mutation.isPending}
            onChangeText={(value) => {
              setQuestion(value);
              requestId.current = undefined;
            }}
            placeholder="What should this specialist help with?"
            style={[pageStyles.field, { minHeight: 120 }]}
          />
          <ActionButton
            disabled={
              !question.trim() ||
              mutation.isPending ||
              previews.isPending ||
              previews.isError ||
              active
            }
            onPress={() => {
              mutation.mutate();
            }}
          >
            {mutation.isPending ? "Starting preview…" : "Run private preview"}
          </ActionButton>
        </>
      )}
      {mutation.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {mutation.error.message} Any accepted request will appear below.
        </Text>
      )}
      {download.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          The preview could not be exported. Try again.
        </Text>
      )}
      {previews.isPending && (
        <Text style={pageStyles.copy}>Loading previews…</Text>
      )}
      {previews.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          Previews could not be loaded. Check your connection and refresh.
        </Text>
      )}
      <ActionButton
        quiet
        onPress={() => {
          void previews.refetch();
        }}
      >
        Refresh previews
      </ActionButton>
      {!previews.isError &&
        previews.data?.map((preview) => (
          <View key={preview.id} style={{ gap: 8, paddingVertical: 12 }}>
            <Text style={pageStyles.rowTitle}>{preview.question}</Text>
            <Text accessibilityLiveRegion="polite" style={pageStyles.copy}>
              {statusLabels[preview.status]}
            </Text>
            <Text style={pageStyles.copy}>
              {new Date(preview.createdAt).toLocaleString()} ·{" "}
              {preview.revision === draft.revision
                ? "Current saved version"
                : "Earlier saved version"}
            </Text>
            {preview.response !== null && (
              <ActionButton
                quiet
                onPress={() => {
                  setSelected(preview);
                }}
              >
                Read response
              </ActionButton>
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
          </View>
        ))}
      {previews.data?.length === 0 && (
        <Text style={pageStyles.copy}>
          No previews yet. Start with a situation your specialist should handle.
        </Text>
      )}
      {selected?.response && (
        <DocumentEditor
          title="Preview response"
          label="Specialist preview response"
          initialText={selected.response}
          maxLength={32000}
          description={`${selected.question}\n\nSaved ${new Date(selected.createdAt).toLocaleString()} · ${selected.revision === draft.revision ? "Current saved version" : "Earlier saved version"}. This is a private preview, not a verified outcome.`}
          markdown
          readOnly
          onSave={async () => {
            throw new Error("Preview results are read-only.");
          }}
          onClose={() => {
            setSelected(undefined);
          }}
        />
      )}
    </CompanionSheet>
  );
}

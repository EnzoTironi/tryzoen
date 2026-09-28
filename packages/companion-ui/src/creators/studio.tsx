import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { pageStyles } from "../page";
import { CreatorDraft } from "./draft";
import {
  creatorPlaybookTemplate,
  type creatorDraftListSchema,
  type creatorDraftSaveSchema,
  type creatorDraftSchema,
} from "./schema";

export interface CreatorStudioData {
  list: () => Promise<z.infer<typeof creatorDraftListSchema>>;
  read: (id: string) => Promise<z.infer<typeof creatorDraftSchema>>;
  save: (
    input: z.infer<typeof creatorDraftSaveSchema>
  ) => Promise<z.infer<typeof creatorDraftSchema>>;
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
  const [title, setTitle] = useState("");
  const [draftId, setDraftId] = useState(data.newId);
  const [selected, setSelected] = useState<string>();
  const drafts = useQuery({
    queryKey: ["creator-drafts", cacheScope],
    queryFn: data.list,
  });
  const create = useMutation({
    mutationFn: () =>
      data.save({
        id: draftId,
        expectedRevision: null,
        content: {
          title,
          description: "",
          playbook: creatorPlaybookTemplate,
          examples: [],
        },
      }),
    onSuccess: async (draft) => {
      setSelected(draft.id);
      setTitle("");
      setDraftId(data.newId());
      await drafts.refetch();
    },
  });
  return (
    <CompanionSheet title="Creator studio" onClose={onClose}>
      <Text style={pageStyles.copy}>
        Turn your expertise into an AI playbook. Start with examples you have
        permission to use, then review your strategies and limits.
      </Text>
      <Text style={pageStyles.copy}>
        Drafts are private to you in this workspace. Publishing and release
        evaluation are not available yet.
      </Text>
      <TextInput
        accessibilityLabel="Specialist name"
        placeholder="Name your specialist"
        value={title}
        onChangeText={setTitle}
        maxLength={80}
        editable={!create.isPending}
        style={pageStyles.field}
      />
      <ActionButton
        disabled={
          !title.trim() ||
          create.isPending ||
          !drafts.data ||
          drafts.data.length >= 20
        }
        onPress={() => {
          create.mutate();
        }}
      >
        {create.isPending ? "Creating…" : "Create a draft"}
      </ActionButton>
      {drafts.isPending && (
        <Text style={pageStyles.copy}>Loading your drafts…</Text>
      )}
      {(drafts.isError || create.isError) && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          Your drafts could not be updated. Your specialist name has been kept.
          Try again.
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
      {drafts.data?.length === 0 && (
        <Text style={pageStyles.copy}>Your first specialist starts here.</Text>
      )}
      {drafts.data?.map((draft) => (
        <View key={draft.id} style={{ gap: 8, paddingVertical: 12 }}>
          <Text style={pageStyles.rowTitle}>{draft.title}</Text>
          <Text style={pageStyles.copy}>
            {draft.examples} authored examples · Private draft
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

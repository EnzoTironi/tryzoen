import { useState } from "react";
import { Text, TextInput } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { ActionButton } from "../button";
import { pageStyles } from "../page";
import { creatorPlaybookTemplate } from "./schema";
import type { CreatorStudioData } from "./studio";

export function CreatorDraftCreate({
  data,
  disabled,
  onCreated,
  onRefresh,
}: {
  readonly data: CreatorStudioData;
  readonly disabled: boolean;
  readonly onCreated: (id: string) => void;
  readonly onRefresh: () => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [draftId, setDraftId] = useState(data.newId);
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
    onError: () => {
      void onRefresh();
    },
    onSuccess: async (draft) => {
      onCreated(draft.id);
      setTitle("");
      setDraftId(data.newId());
      await onRefresh();
    },
  });
  return (
    <>
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
        disabled={!title.trim() || create.isPending || disabled}
        onPress={() => {
          create.mutate();
        }}
      >
        {create.isPending ? "Creating…" : "Create a draft"}
      </ActionButton>
      {create.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {create.error.message}
        </Text>
      )}
    </>
  );
}

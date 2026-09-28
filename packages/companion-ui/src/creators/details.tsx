import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import type { creatorDraftSchema } from "./schema";
import type { CreatorStudioData } from "./studio";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { pageStyles } from "../page";

export function CreatorDetails({
  draft,
  save,
  onSaved,
  onClose,
}: {
  readonly draft: z.infer<typeof creatorDraftSchema>;
  readonly save: CreatorStudioData["save"];
  readonly onSaved: (draft: z.infer<typeof creatorDraftSchema>) => void;
  readonly onClose: () => void;
}) {
  const [title, setTitle] = useState(draft.content.title);
  const [description, setDescription] = useState(draft.content.description);
  const [discarding, setDiscarding] = useState(false);
  const dirty =
    title !== draft.content.title || description !== draft.content.description;
  const mutation = useMutation({
    mutationFn: () =>
      save({
        id: draft.id,
        expectedRevision: draft.revision,
        content: { ...draft.content, title, description },
      }),
    onSuccess: (updated) => {
      onSaved(updated);
      onClose();
    },
  });
  const close = () => {
    if (mutation.isPending) return;
    if (dirty) setDiscarding(true);
    else onClose();
  };
  return (
    <CompanionSheet title="Specialist details" onClose={close}>
      <Text style={pageStyles.rowTitle}>Name</Text>
      <TextInput
        accessibilityLabel="Specialist name"
        value={title}
        maxLength={80}
        editable={!mutation.isPending}
        onChangeText={setTitle}
        style={pageStyles.field}
      />
      <Text style={pageStyles.rowTitle}>What it helps with</Text>
      <TextInput
        accessibilityLabel="Specialist description"
        value={description}
        maxLength={400}
        editable={!mutation.isPending}
        onChangeText={setDescription}
        style={pageStyles.field}
      />
      <ActionButton
        disabled={!title.trim() || !dirty || mutation.isPending}
        onPress={() => {
          mutation.mutate();
        }}
      >
        {mutation.isPending ? "Saving…" : "Save details"}
      </ActionButton>
      {mutation.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {mutation.error.message}
        </Text>
      )}
      {discarding && (
        <View style={{ gap: 8 }}>
          <Text style={pageStyles.rowTitle}>Discard your unsaved changes?</Text>
          <ActionButton
            quiet
            onPress={() => {
              setDiscarding(false);
            }}
          >
            Keep editing
          </ActionButton>
          <ActionButton onPress={onClose}>Discard changes</ActionButton>
        </View>
      )}
    </CompanionSheet>
  );
}

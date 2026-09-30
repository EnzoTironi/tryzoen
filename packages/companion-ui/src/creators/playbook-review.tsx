import { useState } from "react";
import { Text } from "react-native";
import type { z } from "zod";
import type { creatorDraftSchema, creatorPreviewSchema } from "./schema";
import type { CreatorStudioData } from "./studio";
import { ActionButton } from "../button";
import { DocumentEditor } from "../document-editor";
import { usePageStyles } from "../page";

export function CreatorPlaybookReview({
  preview,
  draft,
  data,
  onChanged,
}: {
  readonly preview: z.infer<typeof creatorPreviewSchema>;
  readonly draft: z.infer<typeof creatorDraftSchema>;
  readonly data: CreatorStudioData;
  readonly onChanged: (draft: z.infer<typeof creatorDraftSchema>) => void;
}) {
  const pageStyles = usePageStyles();
  const [editing, setEditing] = useState<z.infer<typeof creatorDraftSchema>>();
  const current = preview.revision === draft.revision && !draft.archivedAt;
  return (
    <>
      <Text style={pageStyles.copy}>
        {current
          ? "This proposal has not changed your playbook. Review its sources and limits, edit it, then explicitly choose to use it."
          : "The draft changed since this proposal. Generate a new proposal from the current examples before replacing its playbook."}
      </Text>
      <ActionButton
        quiet
        disabled={!current}
        onPress={() => {
          setEditing(draft);
        }}
      >
        Review proposed playbook
      </ActionButton>
      {editing && preview.response && (
        <DocumentEditor
          title="Proposed playbook.md"
          label="Proposed specialist playbook"
          description="Check the source attributions, strategies and limits. Saving replaces your private playbook with this edited proposal and requires fresh evaluation runs before another version can be approved. Nothing is published."
          initialText={preview.response}
          maxLength={64000}
          markdown
          allowUnchanged
          saveLabel="Use as playbook"
          onClose={() => {
            setEditing(undefined);
          }}
          onSave={async (playbook) => {
            if (!playbook.trim())
              throw new Error("Write a playbook before saving.");
            const updated = await data.save({
              id: editing.id,
              expectedRevision: editing.revision,
              content: { ...editing.content, playbook },
            });
            onChanged(updated);
          }}
        />
      )}
    </>
  );
}

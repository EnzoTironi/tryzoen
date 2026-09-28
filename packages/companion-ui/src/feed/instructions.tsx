import { useQuery } from "@tanstack/react-query";
import { CompanionSheet } from "../sheet";
import { CompanionPage } from "../page";
import { DocumentEditor } from "../document-editor";
import type { FeedData } from "./collection";

export function FeedInstructions({
  data,
  cacheScope,
  onClose,
}: {
  readonly data: FeedData;
  readonly cacheScope: string;
  readonly onClose: () => void;
}) {
  const instructions = useQuery({
    queryKey: ["feed-instructions", cacheScope],
    queryFn: data.instructions,
    gcTime: 0,
    staleTime: Infinity,
  });
  if (!instructions.data)
    return (
      <CompanionSheet title="Feed instructions" onClose={onClose}>
        <CompanionPage
          title="Feed instructions"
          loading={instructions.isPending}
          error={instructions.error?.message}
          onRetry={() => {
            void instructions.refetch();
          }}
        >
          {null}
        </CompanionPage>
      </CompanionSheet>
    );
  const document = instructions.data;
  return (
    <DocumentEditor
      title="Feed instructions"
      label="Feed instructions"
      description="Choose topics, sources, tone and things to avoid. These personal instructions guide new posts; saving does not enable a recurring schedule."
      initialText={document.content}
      maxLength={20000}
      markdown
      onClose={onClose}
      onSave={async (content) => {
        await data.saveInstructions({ content, revision: document.revision });
      }}
    />
  );
}

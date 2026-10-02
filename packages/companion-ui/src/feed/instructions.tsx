import { useI18n } from "./../i18n";
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
  const { t } = useI18n();
  const instructions = useQuery({
    queryKey: ["feed-instructions", cacheScope],
    queryFn: data.instructions,
    gcTime: 0,
    staleTime: Infinity,
  });
  if (!instructions.data)
    return (
      <CompanionSheet title={t("Feed instructions")} onClose={onClose}>
        <CompanionPage
          title={t("Feed instructions")}
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
      title={t("Feed instructions")}
      label={t("Feed instructions")}
      description={t(
        "Choose topics, sources, tone and things to avoid. These personal instructions guide new posts; saving does not enable a recurring schedule."
      )}
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

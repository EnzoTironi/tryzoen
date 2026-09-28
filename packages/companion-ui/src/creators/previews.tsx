import { Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { pageStyles } from "../page";
import type { creatorDraftSchema } from "./schema";
import type { CreatorStudioData } from "./studio";

import { CreatorPreviewRequest } from "./preview-request";
import { CreatorPreviewResult } from "./preview-result";
import { CreatorPlaybookRequest } from "./playbook-request";

export function CreatorPreviews({
  draft,
  data,
  cacheScope,
  onClose,
  onChanged,
}: {
  readonly draft: z.infer<typeof creatorDraftSchema>;
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
  readonly onClose: () => void;
  readonly onChanged: (draft: z.infer<typeof creatorDraftSchema>) => void;
}) {
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
        Responses and proposals stay private and need your review. Up to 10
        requests in 24 hours and 100 saved results per workspace, shared with
        playbook proposals; the latest 20 results for this draft appear here.
      </Text>
      {!draft.archivedAt && (
        <CreatorPlaybookRequest
          draft={draft}
          data={data}
          disabled={previews.isPending || previews.isError || Boolean(active)}
          onRefresh={previews.refetch}
        />
      )}
      {!draft.archivedAt && (
        <CreatorPreviewRequest
          draft={draft}
          data={data}
          disabled={previews.isPending || previews.isError || Boolean(active)}
          onRefresh={previews.refetch}
        />
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
          <CreatorPreviewResult
            key={preview.id}
            preview={preview}
            draft={draft}
            onChanged={onChanged}
            data={data}
            onRefresh={previews.refetch}
          />
        ))}
      {previews.data?.length === 0 && (
        <Text style={pageStyles.copy}>
          No previews yet. Start with a situation your specialist should handle.
        </Text>
      )}
    </CompanionSheet>
  );
}

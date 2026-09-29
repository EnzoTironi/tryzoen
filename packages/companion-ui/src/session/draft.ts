import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationDraft } from "./input";

/** The editor owns live selection; TanStack owns its navigation/recovery snapshot. */
export function useConversationDraft(
  cacheScope: string,
  sessionId: string,
  initialDraft?: ConversationDraft
) {
  const client = useQueryClient();
  const key = useMemo(
    () => ["agent-draft", cacheScope, sessionId],
    [cacheScope, sessionId]
  );
  const [draft] = useState(
    () => initialDraft ?? client.getQueryData<ConversationDraft>(key)
  );
  useEffect(() => {
    client.setQueryDefaults(key, { gcTime: Infinity });
    if (!client.getQueryData(key))
      client.setQueryData(key, draft ?? { text: "", files: [] });
  }, [client, key, draft]);
  const saveDraft = useCallback(
    (next: ConversationDraft) => {
      if (client.getQueryCache().find({ queryKey: key, exact: true }))
        client.setQueryData(key, next);
    },
    [client, key]
  );
  return { draft, saveDraft };
}

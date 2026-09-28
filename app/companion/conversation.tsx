"use client";
import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import { SessionConversation, NewConversation } from "@zoen/companion-ui";
import { companionReactionData } from "@shared/companion/reactions";
import { api } from "@web/trpc/client";
import { browserSessionClient } from "@web/eve/client";
import { workspaceHref } from "@web/workspaces/navigation";
import {
  readConversationDraft,
  forgetConversationDraft,
  writeConversationDraft,
} from "./drafts";

export function ConnectedConversation({
  sessionId,
  draftScope,
}: {
  readonly sessionId?: string;
  readonly draftScope: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const workspaceId = params.get("space");
  const token = params.get("draft");
  const draft = useMemo(
    () => readConversationDraft(draftScope, token),
    [draftScope, token]
  );
  useEffect(() => {
    forgetConversationDraft(draftScope, token);
  }, [draftScope, token]);
  const { client } = api.useUtils();
  const reactions = useMemo(
    () => companionReactionData(getUntypedClient(client)),
    [client]
  );
  const { mutateAsync: saveChat } = api.chats.save.useMutation();
  return sessionId ? (
    <SessionConversation
      key={`${draftScope}:${sessionId}`}
      reactions={reactions}
      cacheScope={draftScope}
      sessionId={sessionId}
      initialDraft={draft}
      client={browserSessionClient}
      onCopyText={(text) => navigator.clipboard.writeText(text)}
    />
  ) : (
    <NewConversation
      key={token}
      client={browserSessionClient}
      avatarUri="/marketing/zoen-avatar.webp"
      save={(id, name) => saveChat({ sessionId: id, title: name })}
      initialDraft={draft}
      onCreated={(id, retainedDraft) => {
        const retainedToken = retainedDraft
          ? writeConversationDraft(draftScope, retainedDraft)
          : undefined;
        router.replace(
          workspaceHref(
            `/companion/${encodeURIComponent(id)}${retainedToken ? `?draft=${retainedToken}` : ""}`,
            workspaceId
          )
        );
      }}
    />
  );
}

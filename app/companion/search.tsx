"use client";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import { getUntypedClient } from "@trpc/client";
import { companionChatData } from "@shared/companion/chats";
import { useSearchParams } from "next/navigation";
import { authClient } from "@web/auth/client";
import { ConversationSearch } from "@zoen/companion-ui";
import { api } from "@web/trpc/client";
export function ConnectedSearch({
  onConversation,
  title,
  intro,
  allowCreate = true,
  panel,
  selectedId,
}: {
  readonly onConversation: (id?: string) => void;
  readonly title?: string;
  readonly intro?: string;
  readonly allowCreate?: boolean;
  readonly panel?: ComponentProps<typeof ConversationSearch>["panel"];
  readonly selectedId?: string;
}) {
  const { client } = api.useUtils();
  const data = useMemo(
    () => companionChatData(getUntypedClient(client)),
    [client]
  );
  const account = authClient.useSession();
  const params = useSearchParams();
  return (
    <ConversationSearch
      data={data}
      cacheScope={`${account.data?.user.id ?? "anonymous"}:${params.get("space") ?? "personal"}`}
      panel={panel}
      selectedId={selectedId}
      title={title}
      intro={intro}
      onOpen={onConversation}
      onCreate={
        allowCreate
          ? () => {
              onConversation();
            }
          : undefined
      }
    />
  );
}

"use client";
import type { ComponentProps } from "react";
import { ConversationSearch } from "@zoen/companion-ui";
import { companionChatData } from "../../../shared/companion/chats";
import { rpc } from "./api";
import { auth } from "./auth";
import { exportConversation } from "./files/conversation";
const data = companionChatData(rpc);
export function SearchSection({
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
  const account = auth.useSession();
  return (
    <ConversationSearch
      data={data}
      cacheScope={account.data?.user.id ?? "anonymous"}
      panel={panel}
      selectedId={selectedId}
      title={title}
      intro={intro}
      onOpen={onConversation}
      onExport={exportConversation}
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

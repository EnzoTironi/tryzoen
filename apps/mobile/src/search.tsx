"use client";
import { ConversationSearch } from "@zoen/companion-ui";
import { companionChatData } from "../../../shared/companion/chats";
import { rpc } from "./api";
import { auth } from "./auth";
const data = companionChatData(rpc);
export function SearchSection({
  onConversation,
  title,
  intro,
  allowCreate = true,
}: {
  readonly onConversation: (id?: string) => void;
  readonly title?: string;
  readonly intro?: string;
  readonly allowCreate?: boolean;
}) {
  const account = auth.useSession();
  return (
    <ConversationSearch
      data={data}
      cacheScope={account.data?.user.id ?? "anonymous"}
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

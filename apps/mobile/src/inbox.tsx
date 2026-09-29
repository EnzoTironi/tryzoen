import type { ComponentProps } from "react";
import { setStringAsync } from "expo-clipboard";
import { randomUUID } from "expo-crypto";
import { ConversationInbox, RoomConversation } from "@zoen/companion-ui";
import { companionChatData } from "../../../shared/companion/chats";
import { companionInboxData } from "../../../shared/companion/inbox";
import { companionRoomData } from "../../../shared/companion/rooms";
import { rpc } from "./api";
import { auth } from "./auth";
import { apiOrigin } from "./environment";
import { exportConversation } from "./files/conversation";

const chats = companionChatData(rpc);
const inbox = companionInboxData(rpc);
const rooms = companionRoomData(rpc, randomUUID);
export function MobileInbox(
  props: Omit<
    ComponentProps<typeof ConversationInbox>,
    "data" | "inbox" | "rooms" | "cacheScope" | "avatarUri" | "onExport"
  >
) {
  const account = auth.useSession();
  return (
    <ConversationInbox
      {...props}
      data={chats}
      inbox={inbox}
      rooms={rooms}
      cacheScope={account.data?.user.id ?? "anonymous"}
      avatarUri={`${apiOrigin}/marketing/zoen-avatar.webp`}
      onExport={exportConversation}
    />
  );
}
export function MobileRoom(
  props: Omit<ComponentProps<typeof RoomConversation>, "data" | "cacheScope">
) {
  const account = auth.useSession();
  return (
    <RoomConversation
      {...props}
      data={rooms}
      linkOrigin={apiOrigin}
      onCopyText={async (text) => {
        await setStringAsync(text);
      }}
      avatarUri={`${apiOrigin}/marketing/zoen-avatar.webp`}
      cacheScope={account.data?.user.id ?? "anonymous"}
    />
  );
}

import type { ComponentProps } from "react";
import { randomUUID } from "expo-crypto";
import { ConversationInbox, RoomConversation } from "@zoen/companion-ui";
import { companionChatData } from "../../../shared/companion/chats";
import { companionRoomData } from "../../../shared/companion/rooms";
import { rpc } from "./api";
import { auth } from "./auth";
import { apiOrigin } from "./environment";
import { exportConversation } from "./files/conversation";

const chats = companionChatData(rpc);
const rooms = companionRoomData(rpc, randomUUID);
export function MobileInbox(
  props: Omit<
    ComponentProps<typeof ConversationInbox>,
    "data" | "rooms" | "cacheScope" | "avatarUri" | "onExport"
  >
) {
  const account = auth.useSession();
  return (
    <ConversationInbox
      {...props}
      data={chats}
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
      avatarUri={`${apiOrigin}/marketing/zoen-avatar.webp`}
      cacheScope={account.data?.user.id ?? "anonymous"}
    />
  );
}

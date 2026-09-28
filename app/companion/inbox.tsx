"use client";
import { useMemo } from "react";
import { getUntypedClient } from "@trpc/client";
import { ConversationInbox, RoomConversation } from "@zoen/companion-ui";
import { companionChatData } from "@shared/companion/chats";
import { companionRoomData } from "@shared/companion/rooms";
import { api } from "@web/trpc/client";
import { downloadConversationArchive } from "@web/files/download";
import type { ComponentProps } from "react";

export function ConnectedInbox(
  props: Omit<
    ComponentProps<typeof ConversationInbox>,
    "data" | "rooms" | "onExport" | "avatarUri"
  > & { readonly workspaceId: string | null }
) {
  const { client } = api.useUtils();
  const data = useMemo(
    () => companionChatData(getUntypedClient(client)),
    [client]
  );
  const rooms = useMemo(
    () =>
      companionRoomData(getUntypedClient(client), () => crypto.randomUUID()),
    [client]
  );
  return (
    <ConversationInbox
      {...props}
      data={data}
      rooms={rooms}
      avatarUri="/marketing/zoen-avatar.webp"
      onExport={(id) =>
        downloadConversationArchive(
          window.location.origin,
          id,
          props.workspaceId
        )
      }
    />
  );
}
export function ConnectedRoom(
  props: Omit<ComponentProps<typeof RoomConversation>, "data">
) {
  const { client } = api.useUtils();
  const data = useMemo(
    () =>
      companionRoomData(getUntypedClient(client), () => crypto.randomUUID()),
    [client]
  );
  return (
    <RoomConversation
      {...props}
      data={data}
      onCopyText={(text) => navigator.clipboard.writeText(text)}
      avatarUri="/marketing/zoen-avatar.webp"
    />
  );
}

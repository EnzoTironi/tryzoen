import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { inboxNotificationsSchema } from "../chats/inbox-schema";
import type { RoomData } from "./schema";

/** Optimistic reminder badges share the inbox's native-sync cache. */
export function useMarkRoomUnread(
  data: RoomData,
  cacheScope: string,
  roomId: string,
  onMarked: () => void
) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["matrix-unread", cacheScope, roomId],
    mutationFn: () => data.setUnread({ id: roomId, unread: true }),
    onMutate: () => {
      const previous = client.getQueriesData<
        z.infer<typeof inboxNotificationsSchema>
      >({ queryKey: ["matrix-inbox-notifications", cacheScope] });
      for (const [key, entries] of previous)
        client.setQueryData(key, [
          ...(entries ?? []).filter((entry) => entry.id !== roomId),
          {
            id: roomId,
            notificationCount: 0,
            highlightCount: 0,
            ...entries?.find((entry) => entry.id === roomId),
            markedUnread: true,
          },
        ]);
      return previous;
    },
    onError: (_error, _input, previous) => {
      for (const [key, before] of previous ?? [])
        client.setQueryData<z.infer<typeof inboxNotificationsSchema>>(
          key,
          (entries) => {
            const old = before?.find((entry) => entry.id === roomId);
            return entries?.map((entry) =>
              entry.id === roomId
                ? { ...entry, markedUnread: old?.markedUnread ?? false }
                : entry
            );
          }
        );
    },
    onSuccess: onMarked,
  });
}

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { z } from "zod";
import type { inboxNotificationsSchema } from "./inbox-schema";

/** Update only the private reminder; native counters retain their own authority. */
export function updateRoomUnread(
  client: QueryClient,
  scope: string,
  roomId: string,
  unread: boolean
) {
  client.setQueriesData<z.infer<typeof inboxNotificationsSchema>>(
    { queryKey: ["matrix-inbox-notifications", scope] },
    (entries) =>
      entries?.map((entry) =>
        entry.id === roomId ? { ...entry, markedUnread: unread } : entry
      )
  );
}

/** A late poll must not undo a newer local reminder or discard unrelated native counters. */
export function reconcileInboxNotifications(
  client: QueryClient,
  queryKey: QueryKey,
  before: z.infer<typeof inboxNotificationsSchema> | undefined,
  received: z.infer<typeof inboxNotificationsSchema> | null,
  scope: string
) {
  if (received === null) return;
  const local =
    client.getQueryData<z.infer<typeof inboxNotificationsSchema>>(queryKey) ??
    [];
  const edited = local.filter(
    (entry) =>
      entry.markedUnread !==
        before?.find((old) => old.id === entry.id)?.markedUnread ||
      client.isMutating({ mutationKey: ["matrix-unread", scope, entry.id] }) > 0
  );
  client.setQueryData(queryKey, [
    ...received.map((entry) => ({
      ...entry,
      markedUnread:
        edited.find((changed) => changed.id === entry.id)?.markedUnread ??
        entry.markedUnread,
    })),
    ...edited.filter((entry) => !received.some((next) => next.id === entry.id)),
  ]);
}

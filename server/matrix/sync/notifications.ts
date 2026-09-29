import { env } from "@shared/environment";
import type { z } from "zod";
import type { syncCursorSchema } from "./cursor";
import type { pollNativeSync } from "./native";

/** Native snapshots only: omitted delta entries retain the provider's last value. */
export function inboxNotifications(
  previous: z.infer<typeof syncCursorSchema> | null,
  scope: z.infer<typeof syncCursorSchema>["scope"],
  native: Awaited<ReturnType<typeof pollNativeSync>> | null
) {
  const retained = new Map(
    previous?.notifications?.map((entry) => [entry.id, entry])
  );
  const entries = scope.flatMap((room) => {
    if (room.roomId in (native?.rooms?.leave ?? {})) return [];
    const current = native?.rooms?.join?.[room.roomId];
    const value = env.ZOEN_MATRIX_NATIVE_NOTIFICATIONS
      ? current?.unread_notifications
      : undefined;
    const marker = current?.account_data?.events[0];
    const old = retained.get(room.id);
    if (!value && !marker && !old) return [];
    return [
      {
        id: room.id,
        notificationCount:
          value?.notification_count ?? old?.notificationCount ?? 0,
        highlightCount: value?.highlight_count ?? old?.highlightCount ?? 0,
        markedUnread: marker?.content.unread ?? old?.markedUnread ?? false,
      },
    ];
  });
  return entries.length || env.ZOEN_MATRIX_NATIVE_NOTIFICATIONS
    ? entries
    : null;
}

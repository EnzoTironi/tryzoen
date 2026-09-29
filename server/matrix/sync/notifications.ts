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
  if (!env.ZOEN_MATRIX_NATIVE_NOTIFICATIONS) return null;
  const retained = new Map(
    previous?.notifications?.map((entry) => [entry.id, entry])
  );
  return scope.flatMap((room) => {
    if (room.roomId in (native?.rooms?.leave ?? {})) return [];
    const value = native?.rooms?.join?.[room.roomId]?.unread_notifications;
    if (value)
      return [
        {
          id: room.id,
          notificationCount: value.notification_count,
          highlightCount: value.highlight_count,
        },
      ];
    const old = retained.get(room.id);
    return old ? [old] : [];
  });
}

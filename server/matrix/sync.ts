import {
  inboxSyncPageSchema,
  inboxSyncQuerySchema,
} from "@zoen/companion-ui/inbox";
import type { z } from "zod";
import { readInboxSyncHead } from "@db/services/inbox";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { MatrixError, matrixConfiguration } from "./client";
import { ensureMatrixIdentity } from "./identities";
import {
  openSyncCursor,
  sealSyncCursor,
  syncFingerprint,
  type syncCursorSchema,
} from "./sync/cursor";
import { pollNativeSync } from "./sync/native";
import { inboxNotifications } from "./sync/notifications";

/** Foreground metadata invalidation; no transaction is held during provider I/O. */
export async function syncConversationInbox(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.input<typeof inboxSyncQuerySchema>
) {
  const input = inboxSyncQuerySchema.parse(raw);
  await requireWorkspaceAccess(actor);
  if (!actor.authSessionId) throw new WorkspaceAccessDenied();
  try {
    return await readChanges(actor, input);
  } catch (error) {
    if (!(error instanceof MatrixError)) throw error;
    await requireWorkspaceAccess(actor);
    return inboxSyncPageSchema.parse({
      status: "unavailable",
      cursor: input.cursor ?? null,
      inboxChanged: false,
      changedRoomIds: [],
      gapRoomIds: [],
      reset: false,
      notifications: null,
    });
  }
}
async function readChanges(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof inboxSyncQuerySchema>
) {
  const config = await matrixConfiguration();
  const previous = await openSyncCursor(actor, config.serverName, input.cursor);
  const { query, filter, archived, focusedRoomId } = input;
  const selection = syncFingerprint({ query, filter, archived, focusedRoomId });
  const { head, current, native, reconciled } = await readAuthorizedChanges(
    actor,
    input,
    previous?.selection === selection ? previous : null
  );
  const fingerprint = syncFingerprint(head.rows);
  const reset =
    !previous ||
    previous.selection !== selection ||
    syncFingerprint(previous.scope) !== syncFingerprint(current.scope);
  const changedRoomIds = current.scope
    .filter(
      (room) =>
        reset ||
        (native?.rooms?.join?.[room.roomId]?.timeline?.events.length ?? 0) >
          0 ||
        room.roomId in (native?.rooms?.leave ?? {})
    )
    .map((room) => room.id);
  const gapRoomIds = current.scope
    .filter((room) => native?.rooms?.join?.[room.roomId]?.timeline?.limited)
    .map((room) => room.id);
  const notifications = inboxNotifications(
    reconciled ? previous : null,
    current.scope.filter((room) =>
      head.scope.some(
        (known) => known.id === room.id && known.epoch === room.epoch
      )
    ),
    native
  );
  const cursor = await sealSyncCursor({
    purpose: "matrix-inbox-sync-v1",
    userId: actor.userId,
    sessionId: actor.authSessionId ?? "",
    workspaceId: actor.workspaceId,
    serverName: config.serverName,
    selection,
    head: syncFingerprint(current.rows),
    // A native cursor covers the requested scope, not a newer head discovered
    // during I/O. Retaining that scope forces bootstrap for newly admitted rooms.
    scope: head.scope,
    nextBatch: native?.next_batch ?? null,
    notifications,
    expiresAt: Date.now() + 86_400_000,
  });
  return inboxSyncPageSchema.parse({
    status: "ready",
    cursor,
    inboxChanged:
      reset ||
      previous.head !== fingerprint ||
      changedRoomIds.length > 0 ||
      syncFingerprint(current.rows) !== fingerprint,
    changedRoomIds,
    gapRoomIds,
    reset,
    // Initial /sync snapshots may be cached. Show counts only after their native
    // next_batch has been reconciled, never label that initial cache as current.
    notifications: reconciled ? notifications : null,
  });
}

async function readAuthorizedChanges(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof inboxSyncQuerySchema>,
  previous: z.infer<typeof syncCursorSchema> | null
) {
  const options = {
    query: input.query,
    filter: input.filter,
    archived: input.archived,
  };
  const head = await readInboxSyncHead(actor, options, input.focusedRoomId);
  const since =
    previous && syncFingerprint(previous.scope) === syncFingerprint(head.scope)
      ? previous.nextBatch
      : null;
  const native = head.scope.length
    ? await pollNativeSync(
        await ensureMatrixIdentity(actor),
        head.scope.map((room) => room.roomId),
        since,
        "inbox"
      )
    : null;
  // The second authorization removes revoked rooms and detects head changes during I/O.
  const current = await readInboxSyncHead(actor, options, input.focusedRoomId);
  return { head, current, native, reconciled: !!since };
}

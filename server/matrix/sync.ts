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
import { openSyncCursor, sealSyncCursor, syncFingerprint } from "./sync/cursor";
import { pollNativeSync } from "./sync/native";

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
  const since = previous?.selection === selection ? previous.nextBatch : null;
  const { head, current, native } = await readAuthorizedChanges(
    actor,
    input,
    since
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
  const cursor = await sealSyncCursor({
    purpose: "matrix-inbox-sync-v1",
    userId: actor.userId,
    sessionId: actor.authSessionId ?? "",
    workspaceId: actor.workspaceId,
    serverName: config.serverName,
    selection,
    head: syncFingerprint(current.rows),
    scope: current.scope,
    nextBatch: native?.next_batch ?? null,
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
  });
}

async function readAuthorizedChanges(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof inboxSyncQuerySchema>,
  since: string | null
) {
  const options = {
    query: input.query,
    filter: input.filter,
    archived: input.archived,
  };
  const head = await readInboxSyncHead(actor, options, input.focusedRoomId);
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
  return { head, current, native };
}

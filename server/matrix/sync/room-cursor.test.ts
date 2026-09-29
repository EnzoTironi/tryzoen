import { expect, test, vi } from "vitest";
import { openRoomSyncCursor, sealRoomSyncCursor } from "./room-cursor";
vi.mock("@db/services/auth", () => ({
  getAuth: async () => ({
    $context: Promise.resolve({
      secretConfig: "synthetic-typing-cursor-key-long-enough",
    }),
  }),
}));
const actor = {
  userId: "viewer",
  authSessionId: "session",
  workspaceId: "workspace",
};
test("typing cursor is opaque, purpose-bound, rejects tampering and expires", async () => {
  const envelope = {
    purpose: "matrix-room-sync-v2" as const,
    userId: actor.userId,
    sessionId: actor.authSessionId,
    workspaceId: actor.workspaceId,
    roomId: "!private:test",
    epoch: "one",
    nextBatch: "private-native-token",
    issuedAt: Date.now(),
    presencePublishedAt: Date.now(),
    userIds: ["@private:test"],
    expiresAt: Date.now() + 30000,
  };
  const cursor = await sealRoomSyncCursor(envelope);
  expect(cursor).not.toContain(envelope.nextBatch);
  expect(cursor).not.toContain(envelope.userIds[0]);
  expect(await openRoomSyncCursor(actor, cursor)).toEqual(envelope);
  await expect(
    openRoomSyncCursor({ ...actor, authSessionId: "other" }, cursor)
  ).rejects.toThrow("WorkspaceAccessDenied");
  await expect(openRoomSyncCursor(actor, `${cursor}changed`)).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
  expect(
    await openRoomSyncCursor(
      actor,
      await sealRoomSyncCursor({ ...envelope, issuedAt: Date.now() - 86400001 })
    )
  ).toBeNull();
});

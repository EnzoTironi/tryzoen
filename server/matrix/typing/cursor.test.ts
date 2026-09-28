import { expect, test, vi } from "vitest";
import { openTypingCursor, sealTypingCursor } from "./cursor";
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
    purpose: "matrix-room-typing-v1" as const,
    userId: actor.userId,
    sessionId: actor.authSessionId,
    workspaceId: actor.workspaceId,
    roomId: "!private:test",
    epoch: "one",
    nextBatch: "private-native-token",
    issuedAt: Date.now(),
    userIds: ["@private:test"],
    expiresAt: Date.now() + 30000,
  };
  const cursor = await sealTypingCursor(envelope);
  expect(cursor).not.toContain(envelope.nextBatch);
  expect(cursor).not.toContain(envelope.userIds[0]);
  expect(await openTypingCursor(actor, cursor)).toEqual(envelope);
  await expect(
    openTypingCursor({ ...actor, authSessionId: "other" }, cursor)
  ).rejects.toThrow("WorkspaceAccessDenied");
  await expect(openTypingCursor(actor, `${cursor}changed`)).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
  expect(
    await openTypingCursor(
      actor,
      await sealTypingCursor({ ...envelope, issuedAt: Date.now() - 86400001 })
    )
  ).toBeNull();
});

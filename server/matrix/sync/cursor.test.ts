import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { openSyncCursor, sealSyncCursor } from "./cursor";
import { WorkspaceAccessDenied } from "../../workspaces/access";
vi.mock("@db/services/auth", () => ({
  getAuth: async () => ({
    $context: Promise.resolve({
      secretConfig: "synthetic-cursor-key-long-enough-for-test",
    }),
  }),
}));
const actor = {
  userId: "viewer",
  workspaceId: "workspace",
  authSessionId: "session",
};
const envelope = {
  purpose: "matrix-inbox-sync-v1" as const,
  userId: actor.userId,
  sessionId: actor.authSessionId,
  workspaceId: actor.workspaceId,
  serverName: "test",
  selection: "query",
  head: "head",
  nextBatch: "native-secret-position",
  notifications: null,
  scope: [{ id: randomUUID(), roomId: "!private:test", epoch: "epoch" }],
  expiresAt: Date.now() + 60000,
};
it("encrypts native position and binds account, session, workspace and server", async () => {
  const cursor = await sealSyncCursor(envelope);
  expect(cursor).not.toContain(envelope.nextBatch);
  expect(cursor).not.toContain(envelope.scope[0]?.roomId);
  expect(await openSyncCursor(actor, "test", cursor)).toEqual(envelope);
  for (const wrong of [
    { ...actor, userId: "other" },
    { ...actor, workspaceId: "other" },
    { ...actor, authSessionId: "other" },
  ])
    await expect(openSyncCursor(wrong, "test", cursor)).rejects.toThrow(
      WorkspaceAccessDenied
    );
  await expect(openSyncCursor(actor, "other", cursor)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  await expect(openSyncCursor(actor, "test", `${cursor}x`)).rejects.toThrow(
    WorkspaceAccessDenied
  );
});
it("expires a valid cursor into an explicit bootstrap", async () => {
  expect(
    await openSyncCursor(
      actor,
      "test",
      await sealSyncCursor({ ...envelope, expiresAt: Date.now() - 1 })
    )
  ).toBeNull();
});

import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { syncConversationInbox } from "./sync";
import { MatrixError } from "./client";
import { WorkspaceAccessDenied } from "../workspaces/access";
import type { readInboxSyncHead } from "@db/services/inbox";
import type { pollNativeSync } from "./sync/native";
const mocks = vi.hoisted(() => ({
  head: vi.fn<typeof readInboxSyncHead>(),
  native: vi.fn<typeof pollNativeSync>(),
  access: vi.fn<() => Promise<void>>(),
}));
vi.mock("@db/services/inbox", () => ({ readInboxSyncHead: mocks.head }));
vi.mock("@db/services/auth", () => ({
  getAuth: async () => ({
    $context: Promise.resolve({
      secretConfig: "synthetic-sync-test-key-long-enough",
    }),
  }),
}));
vi.mock("./sync/native", () => ({ pollNativeSync: mocks.native }));
vi.mock("./identities", () => ({
  ensureMatrixIdentity: async () => "@viewer:test",
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixConfiguration: async () => ({ serverName: "test" }),
}));
vi.mock("../workspaces/access", async (original) => ({
  ...(await original<typeof import("../workspaces/access")>()),
  requireWorkspaceAccess: mocks.access,
}));
const actor = {
  userId: "viewer",
  workspaceId: "workspace",
  authSessionId: "session",
};
const room = { id: randomUUID(), roomId: "!room:test", epoch: "epoch" };
beforeEach(() => {
  mocks.head.mockReset().mockResolvedValue({ rows: [], scope: [room] });
  mocks.access.mockReset().mockResolvedValue(undefined);
  mocks.native.mockReset().mockResolvedValue({
    next_batch: "next",
    rooms: {
      join: {
        [room.roomId]: {
          timeline: {
            events: [{ event_id: "$event", type: "m.room.message" }],
          },
        },
      },
    },
  });
});
it("does not return metadata for rooms revoked during the provider call", async () => {
  mocks.head
    .mockResolvedValueOnce({ rows: [], scope: [room] })
    .mockResolvedValueOnce({ rows: [], scope: [] });
  const page = await syncConversationInbox(actor, {});
  expect(page.changedRoomIds).toEqual([]);
  expect(page.reset).toBe(true);
  expect(mocks.head).toHaveBeenCalledTimes(2);
});
it("reports provider unavailability and preserves the unacknowledged cursor", async () => {
  mocks.native.mockRejectedValue(new MatrixError({ reason: "unavailable" }));
  expect(await syncConversationInbox(actor, {})).toMatchObject({
    status: "unavailable",
    cursor: null,
    changedRoomIds: [],
    reset: false,
  });
  mocks.native.mockRejectedValue(new Error("Unexpected database failure"));
  await expect(syncConversationInbox(actor, {})).rejects.toThrow(
    "Unexpected database failure"
  );
});
it("still rejects session revocation while handling a provider failure", async () => {
  mocks.native.mockRejectedValue(new MatrixError({ reason: "unavailable" }));
  mocks.access
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(syncConversationInbox(actor, {})).rejects.toThrow(
    WorkspaceAccessDenied
  );
});

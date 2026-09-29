import { z } from "zod";
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
vi.mock("@shared/environment", () => ({
  env: { ZOEN_MATRIX_NATIVE_NOTIFICATIONS: true },
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
it("reconciles initial snapshots before exposing native counts and preserves omitted deltas", async () => {
  mocks.native.mockResolvedValueOnce({
    next_batch: "initial",
    rooms: {
      join: {
        [room.roomId]: {
          unread_notifications: { notification_count: 2, highlight_count: 1 },
        },
      },
    },
  });
  const seed = await syncConversationInbox(actor, {});
  expect(seed.notifications).toBeNull();
  mocks.native.mockResolvedValue({ next_batch: "incremental", rooms: {} });
  const current = await syncConversationInbox(actor, {
    cursor: z.string().parse(seed.cursor),
  });
  expect(current.notifications).toEqual([
    {
      id: room.id,
      notificationCount: 2,
      highlightCount: 1,
      markedUnread: false,
    },
  ]);
  expect(mocks.native).toHaveBeenLastCalledWith(
    "@viewer:test",
    [room.roomId],
    "initial",
    "inbox"
  );
  mocks.native.mockResolvedValue({
    next_batch: "read",
    rooms: {
      join: {
        [room.roomId]: {
          unread_notifications: { notification_count: 0, highlight_count: 0 },
        },
      },
    },
  });
  const read = await syncConversationInbox(actor, {
    cursor: z.string().parse(current.cursor),
  });
  expect(read.notifications).toEqual([
    {
      id: room.id,
      notificationCount: 0,
      highlightCount: 0,
      markedUnread: false,
    },
  ]);
  await expect(
    syncConversationInbox(
      { ...actor, userId: "other" },
      { cursor: z.string().parse(read.cursor) }
    )
  ).rejects.toThrow(WorkspaceAccessDenied);
});
it("drops revoked snapshots and reboots native scope when membership epoch changes", async () => {
  mocks.native.mockResolvedValue({
    next_batch: "initial",
    rooms: {
      join: {
        [room.roomId]: {
          unread_notifications: { notification_count: 4, highlight_count: 0 },
        },
      },
    },
  });
  const seed = await syncConversationInbox(actor, {});
  mocks.head.mockResolvedValue({
    rows: [],
    scope: [{ ...room, epoch: "new" }],
  });
  const reset = await syncConversationInbox(actor, {
    cursor: z.string().parse(seed.cursor),
  });
  expect(reset.notifications).toBeNull();
  expect(mocks.native).toHaveBeenLastCalledWith(
    "@viewer:test",
    [room.roomId],
    null,
    "inbox"
  );
  mocks.head
    .mockResolvedValueOnce({ rows: [], scope: [{ ...room, epoch: "new" }] })
    .mockResolvedValueOnce({ rows: [], scope: [] });
  const revoked = await syncConversationInbox(actor, {
    cursor: z.string().parse(reset.cursor),
  });
  expect(revoked.notifications).toEqual([]);
});
it("bootstraps a room entering the head during I/O even when it has no later event", async () => {
  const other = {
    id: randomUUID(),
    roomId: "!already-unread:test",
    epoch: "one",
  };
  mocks.native.mockResolvedValue({ next_batch: "initial-a", rooms: {} });
  const seed = await syncConversationInbox(actor, {});
  mocks.head
    .mockResolvedValueOnce({ rows: [], scope: [room] })
    .mockResolvedValueOnce({ rows: [], scope: [room, other] });
  mocks.native.mockResolvedValue({ next_batch: "polled-a", rooms: {} });
  const raced = await syncConversationInbox(actor, {
    cursor: z.string().parse(seed.cursor),
  });
  mocks.head.mockResolvedValue({ rows: [], scope: [room, other] });
  mocks.native.mockResolvedValue({
    next_batch: "initial-ab",
    rooms: {
      join: {
        [other.roomId]: {
          unread_notifications: { notification_count: 7, highlight_count: 1 },
        },
      },
    },
  });
  const bootstrap = await syncConversationInbox(actor, {
    cursor: z.string().parse(raced.cursor),
  });
  expect(mocks.native).toHaveBeenLastCalledWith(
    "@viewer:test",
    [room.roomId, other.roomId],
    null,
    "inbox"
  );
  expect(bootstrap.notifications).toBeNull();
  mocks.native.mockResolvedValue({ next_batch: "unchanged-ab", rooms: {} });
  const reconciled = await syncConversationInbox(actor, {
    cursor: z.string().parse(bootstrap.cursor),
  });
  expect(reconciled.notifications).toContainEqual({
    id: other.id,
    markedUnread: false,
    notificationCount: 7,
    highlightCount: 1,
  });
});

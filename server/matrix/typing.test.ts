import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { setMatrixTyping } from "./typing";
import { readMatrixRoomSync } from "./sync/room";
import { WorkspaceAccessDenied } from "../workspaces/access";
const mocks = vi.hoisted(() => ({
  join: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  access: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  native: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  open: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  seal: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  request: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  changes: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("./rooms", () => ({
  joinMatrixRoom: mocks.join,
  requireMatrixRoom: mocks.access,
}));
vi.mock("./sync/native", () => ({ pollNativeSync: mocks.native }));
vi.mock("./sync/changes", () => ({ readRoomChanges: mocks.changes }));
vi.mock("./sync/room-cursor", () => ({
  openRoomSyncCursor: mocks.open,
  sealRoomSyncCursor: mocks.seal,
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
}));
const actor = {
  userId: "user",
  authSessionId: "session",
  workspaceId: "workspace",
};
const room = {
  id: "00000000-0000-4000-8000-000000000001",
  roomId: "!room:test",
  epoch: "one",
  matrixId: "@viewer:test",
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  mocks.join.mockReset().mockResolvedValue(room);
  mocks.access.mockReset().mockResolvedValue(room);
  mocks.open.mockReset().mockResolvedValue(null);
  mocks.seal.mockReset().mockResolvedValue("sealed");
  mocks.native.mockReset().mockResolvedValue({
    next_batch: "s2",
    rooms: {
      join: {
        [room.roomId]: {
          ephemeral: {
            events: [
              {
                type: "m.typing",
                content: { user_ids: ["@author:test", room.matrixId] },
              },
            ],
          },
        },
      },
    },
  });
  mocks.request.mockReset().mockResolvedValue({});
  mocks.changes.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());
test("initial cached snapshot seeds only and same request replay has fixed expiry", async () => {
  expect(await readMatrixRoomSync(actor, { id: room.id })).toMatchObject({
    userIds: [],
    expiresAt: 0,
  });
  mocks.open.mockResolvedValue({
    roomId: room.roomId,
    epoch: room.epoch,
    nextBatch: "s1",
    issuedAt: 100000,
    userIds: [],
    expiresAt: 0,
  });
  const first = await readMatrixRoomSync(actor, {
    id: room.id,
    cursor: "same",
  });
  expect(first).toMatchObject({ userIds: ["@author:test"], expiresAt: 130000 });
  vi.setSystemTime(110000);
  expect(
    await readMatrixRoomSync(actor, { id: room.id, cursor: "same" })
  ).toEqual(first);
  vi.setSystemTime(131000);
  expect(
    await readMatrixRoomSync(actor, { id: room.id, cursor: "same" })
  ).toMatchObject({ userIds: [], expiresAt: 130000 });
});
test("revocation during I/O fails closed and cursor cannot cross room epochs", async () => {
  mocks.access.mockRejectedValue(new WorkspaceAccessDenied());
  await expect(
    readMatrixRoomSync(actor, { id: room.id })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  mocks.open.mockResolvedValue({ roomId: room.roomId, epoch: "other" });
  await expect(
    readMatrixRoomSync(actor, { id: room.id, cursor: "wrong" })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("bootstrap requires reconciliation, but an idle incremental read does not reload history", async () => {
  expect(await readMatrixRoomSync(actor, { id: room.id })).toMatchObject({
    reset: true,
    timelineChanged: false,
  });
  mocks.open.mockResolvedValue({
    roomId: room.roomId,
    epoch: room.epoch,
    nextBatch: "s1",
    issuedAt: 100000,
    userIds: [],
  });
  expect(
    await readMatrixRoomSync(actor, { id: room.id, cursor: "previous" })
  ).toMatchObject({ reset: false, timelineChanged: false });
});

test.each(["m.room.message", "m.room.redaction", "m.room.member"])(
  "%s falls back to authorized history when a batch cannot be applied",
  async (type) => {
    mocks.open.mockResolvedValue({
      roomId: room.roomId,
      epoch: room.epoch,
      nextBatch: "s1",
      issuedAt: 100000,
      userIds: [],
    });
    mocks.native.mockResolvedValue({
      next_batch: "s2",
      rooms: {
        join: {
          [room.roomId]: {
            timeline: {
              events: [
                {
                  event_id: "$change",
                  type,
                  content: { body: "Private content" },
                },
              ],
            },
          },
        },
      },
    });
    const result = await readMatrixRoomSync(actor, {
      id: room.id,
      cursor: "previous",
    });
    expect(result).toMatchObject({ reset: false, timelineChanged: true });
    expect(JSON.stringify(result)).not.toContain("Private content");
  }
);

test("a limited native timeline requests recovery even if its event list is empty", async () => {
  mocks.open.mockResolvedValue({
    roomId: room.roomId,
    epoch: room.epoch,
    nextBatch: "s1",
    issuedAt: 100000,
    userIds: [],
  });
  mocks.native.mockResolvedValue({
    next_batch: "s2",
    rooms: {
      join: { [room.roomId]: { timeline: { events: [], limited: true } } },
    },
  });
  expect(
    await readMatrixRoomSync(actor, { id: room.id, cursor: "previous" })
  ).toMatchObject({ reset: true, timelineChanged: false });
});
test("access is rechecked after authoritative change projection, before exposing content", async () => {
  mocks.open.mockResolvedValue({
    roomId: room.roomId,
    epoch: room.epoch,
    nextBatch: "s1",
    issuedAt: 100000,
    userIds: [],
  });
  mocks.native.mockResolvedValue({
    next_batch: "s2",
    rooms: {
      join: {
        [room.roomId]: {
          timeline: { events: [{ event_id: "$new", type: "m.room.message" }] },
        },
      },
    },
  });
  mocks.changes.mockImplementation(async () => {
    mocks.access.mockResolvedValue({
      ...room,
      epoch: "revoked-during-projection",
    });
    return { added: [], updated: [] };
  });
  await expect(
    readMatrixRoomSync(actor, { id: room.id, cursor: "previous" })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(mocks.changes).toHaveBeenCalledTimes(1);
  expect(mocks.seal).not.toHaveBeenCalled();
});
test("publisher derives sender, applies finite lease and rejects delegated actors", async () => {
  await setMatrixTyping(actor, { id: room.id, typing: true });
  expect(mocks.request).toHaveBeenCalledWith(
    "PUT",
    `rooms/${encodeURIComponent(room.roomId)}/typing/${encodeURIComponent(room.matrixId)}`,
    { typing: true, timeout: 20000 },
    room.matrixId
  );
  await setMatrixTyping(actor, { id: room.id, typing: false });
  expect(mocks.request).toHaveBeenLastCalledWith(
    "PUT",
    expect.any(String),
    { typing: false },
    room.matrixId
  );
  await expect(
    setMatrixTyping(
      { ...actor, groupBindingId: "group" },
      { id: room.id, typing: true }
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

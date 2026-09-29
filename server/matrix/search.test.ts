import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { searchMatrixMessages } from "./search";
import { WorkspaceAccessDenied } from "../workspaces/access";
import type { matrixRequest } from "./client";
import type { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import type { readRoomMessage } from "./messages";

const mocks = vi.hoisted(() => ({
  request: vi.fn<typeof matrixRequest>(),
  join: vi.fn<typeof joinMatrixRoom>(),
  access: vi.fn<typeof requireMatrixRoom>(),
  event: vi.fn<typeof readRoomMessage>(),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({ serverName: "test", botId: "@bot:test" }),
}));
vi.mock("./rooms", () => ({
  joinMatrixRoom: mocks.join,
  requireMatrixRoom: mocks.access,
}));
vi.mock("./members", () => ({ readRoomMembers: async () => [] }));
vi.mock("./messages", async (original) => ({
  ...(await original<typeof import("./messages")>()),
  readRoomMessage: mocks.event,
}));
vi.mock("@db/services/auth", () => ({
  getAuth: async () => ({
    $context: Promise.resolve({
      secretConfig: "synthetic-search-key-long-enough-for-test",
    }),
  }),
}));
const actor = {
  userId: "viewer",
  workspaceId: "workspace",
  authSessionId: "session",
};
const room = {
  id: randomUUID(),
  roomId: "!room:test",
  workspaceId: "workspace",
  epoch: "epoch",
  label: "Room",
  kind: "group" as const,
  matrixId: "@viewer:test",
};
const event = {
  event_id: "$original",
  room_id: room.roomId,
  type: "m.room.message",
  sender: room.matrixId,
  content: { body: "current", msgtype: "m.text" },
  origin_server_ts: 1,
};
beforeEach(() => {
  mocks.join.mockReset().mockResolvedValue(room);
  mocks.access.mockReset().mockResolvedValue(room);
  mocks.event.mockReset().mockResolvedValue(event);
  mocks.request.mockReset().mockResolvedValue({
    search_categories: { room_events: { results: [{ result: event }] } },
  });
});
it("revalidates access after hydration and returns no content after revocation", async () => {
  mocks.access.mockRejectedValue(new WorkspaceAccessDenied());
  await expect(
    searchMatrixMessages(actor, { id: room.id, query: "current" })
  ).rejects.toThrow(WorkspaceAccessDenied);
  expect(mocks.event).toHaveBeenCalledTimes(1);
});
it("rejects cross-room native hits before hydrating them", async () => {
  mocks.request.mockResolvedValue({
    search_categories: {
      room_events: {
        results: [{ result: { ...event, room_id: "!other:test" } }],
      },
    },
  });
  await expect(
    searchMatrixMessages(actor, { id: room.id, query: "current" })
  ).rejects.toThrow(WorkspaceAccessDenied);
  expect(mocks.event).not.toHaveBeenCalled();
});
it("keeps native continuation on empty redacted pages and stops a repeated token", async () => {
  mocks.request.mockResolvedValue({
    search_categories: {
      room_events: { results: [{ result: event }], next_batch: "native-next" },
    },
  });
  mocks.event.mockResolvedValue({
    ...event,
    content: {},
    unsigned: { redacted_because: {} },
  });
  const first = await searchMatrixMessages(actor, {
    id: room.id,
    query: "current",
  });
  expect(first.items).toEqual([]);
  expect(first.nextCursor).toBeTypeOf("string");
  const next = await searchMatrixMessages(actor, {
    id: room.id,
    query: "current",
    cursor: first.nextCursor ?? undefined,
  });
  expect(next.nextCursor).toBeNull();
});
it("binds pagination to authenticated session and current membership epoch", async () => {
  mocks.request.mockResolvedValue({
    search_categories: {
      room_events: { results: [], next_batch: "native-next" },
    },
  });
  const first = await searchMatrixMessages(actor, {
    id: room.id,
    query: "current",
  });
  await expect(
    searchMatrixMessages(
      { ...actor, authSessionId: "other-session" },
      { id: room.id, query: "current", cursor: first.nextCursor ?? undefined }
    )
  ).rejects.toThrow(WorkspaceAccessDenied);
  mocks.join.mockResolvedValue({ ...room, epoch: "new-epoch" });
  await expect(
    searchMatrixMessages(actor, {
      id: room.id,
      query: "current",
      cursor: first.nextCursor ?? undefined,
    })
  ).rejects.toThrow(WorkspaceAccessDenied);
});

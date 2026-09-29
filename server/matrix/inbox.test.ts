import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { matrixRequest } from "./client";
import { MatrixError } from "./client";
import { readMatrixInboxSummaries } from "./inbox";
import { WorkspaceAccessDenied } from "../workspaces/access";

const mocks = vi.hoisted(() => ({
  query: vi.fn<() => Promise<unknown[]>>(),
  request: vi.fn<typeof matrixRequest>(),
  access: vi.fn<() => Promise<void>>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../workspaces/access", async (original) => ({
  ...(await original<typeof import("../workspaces/access")>()),
  requireWorkspaceAccess: mocks.access,
}));
vi.mock("./identities", () => ({
  ensureMatrixIdentity: async () => "@viewer:test",
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({ serverName: "test" }),
}));
const actor = {
  userId: "viewer",
  workspaceId: "workspace",
  authSessionId: "session",
};
const rooms = Array.from({ length: 30 }, (_, index) => ({
  id: randomUUID(),
  roomId: `!room${index}:test`,
  workspaceId: "workspace",
  epoch: randomUUID(),
  label: `Room ${index}`,
  kind: "group",
  username: null,
  avatarUri: null,
  ready: true,
  latestEdited: false,
  latestEventId: `$event${index}`,
}));
const firstRoom = rooms[0];
if (!firstRoom) throw new Error("Fixture requires one room");
beforeEach(() => {
  mocks.query.mockReset().mockResolvedValue(rooms);
  mocks.access.mockReset().mockResolvedValue(undefined);
  mocks.request.mockReset().mockImplementation(async (_method, path) => {
    const index = rooms.findIndex((room) =>
      path.includes(encodeURIComponent(room.roomId))
    );
    const room = rooms[index];
    if (!room) throw new Error("Unexpected room");
    return {
      event_id: room.latestEventId,
      room_id: room.roomId,
      type: "m.room.message",
      sender: "@other:test",
      content: { body: "Visible", msgtype: "m.text" },
    };
  });
});
it("authorizes the whole page twice with at most thirty exact event reads", async () => {
  const result = await readMatrixInboxSummaries(
    actor,
    rooms.map((room) => room.id)
  );
  expect(result.size).toBe(30);
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.request).toHaveBeenCalledTimes(30);
  expect(
    mocks.request.mock.calls.every(
      ([method, path, , viewer]) =>
        method === "GET" &&
        path.includes("/event/") &&
        !path.includes("/messages") &&
        viewer === "@viewer:test"
    )
  ).toBe(true);
});
it("keeps provider unavailability scoped while propagating unexpected failures", async () => {
  mocks.query.mockResolvedValue([rooms[0]]);
  mocks.request.mockRejectedValue(new MatrixError({ reason: "unavailable" }));
  expect(
    (await readMatrixInboxSummaries(actor, [firstRoom.id])).get(firstRoom.id)
  ).toEqual({ preview: null, summaryState: "unavailable" });
  mocks.request.mockRejectedValue(new Error("Unexpected"));
  await expect(readMatrixInboxSummaries(actor, [firstRoom.id])).rejects.toThrow(
    "Unexpected"
  );
});
it("discards fetched content when access disappears during the request", async () => {
  mocks.query.mockResolvedValueOnce([rooms[0]]).mockResolvedValueOnce([]);
  await expect(readMatrixInboxSummaries(actor, [firstRoom.id])).rejects.toThrow(
    WorkspaceAccessDenied
  );
});
it("does not fetch a room whose history has not reconciled", async () => {
  mocks.query.mockResolvedValue([{ ...rooms[0], ready: false }]);
  expect(
    (await readMatrixInboxSummaries(actor, [firstRoom.id])).get(firstRoom.id)
      ?.summaryState
  ).toBe("pending");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects oversized pages before any database or provider work", async () => {
  await expect(
    readMatrixInboxSummaries(actor, [
      ...rooms.map((room) => room.id),
      randomUUID(),
    ])
  ).rejects.toThrow("Too big");
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
});
it("suppresses original bodies when edit metadata is conservative", async () => {
  mocks.query.mockResolvedValue([{ ...firstRoom, latestEdited: true }]);
  expect(
    (await readMatrixInboxSummaries(actor, [firstRoom.id])).get(firstRoom.id)
      ?.preview
  ).toBe("Mensagem editada");
});
it("redaction wins over edited metadata and never leaks stale media", async () => {
  mocks.query.mockResolvedValue([{ ...firstRoom, latestEdited: true }]);
  mocks.request.mockResolvedValue({
    event_id: firstRoom.latestEventId,
    room_id: firstRoom.roomId,
    type: "m.room.message",
    sender: "@other:test",
    content: {
      body: "Sensitive",
      url: "mxc://private/file",
      msgtype: "m.image",
    },
    unsigned: { redacted_because: {} },
  });
  expect(
    (await readMatrixInboxSummaries(actor, [firstRoom.id])).get(firstRoom.id)
      ?.preview
  ).toBe("Mensagem removida");
});

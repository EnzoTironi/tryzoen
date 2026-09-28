import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { listSavedMatrixMessages } from "./saved";
import type { matrixRequest } from "./client";
const mocks = vi.hoisted(() => ({
  query: vi.fn<() => Promise<unknown[]>>(),
  request: vi.fn<typeof matrixRequest>(),
  access: vi.fn<() => Promise<void>>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: (run: () => Promise<unknown>) => run(),
}));
vi.mock("./identities", () => ({
  ensureMatrixIdentity: async () => "@viewer:test",
}));
vi.mock("./inbox", () => ({ authorizedInboxRooms: async () => sql`` }));
vi.mock("../workspaces/access", async (original) => ({
  ...(await original<typeof import("../workspaces/access")>()),
  requireWorkspaceAccess: mocks.access,
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({ botId: "@bot:test" }),
}));
it("drops source metadata if membership disappears during exact-event hydration", async () => {
  const id = randomUUID();
  const key = randomUUID();
  const room = {
    id,
    roomId: "!room:test",
    label: "Private team",
    kind: "group",
    epoch: randomUUID(),
  };
  mocks.query.mockResolvedValueOnce([room]).mockResolvedValueOnce([]);
  mocks.request
    .mockResolvedValueOnce({
      version: 1,
      items: [
        {
          key,
          workspaceId: "space",
          id,
          roomId: room.roomId,
          eventId: "$event",
          savedAt: 1,
        },
      ],
    })
    .mockResolvedValueOnce({
      event_id: "$event",
      room_id: room.roomId,
      type: "m.room.message",
      sender: "@sender:test",
      content: { msgtype: "m.text", body: "Private text" },
    });
  const result = await listSavedMatrixMessages(
    { userId: "viewer", workspaceId: "space", authSessionId: "session" },
    {}
  );
  expect(result.items).toEqual([
    {
      key,
      reference: { id, messageId: "$event" },
      savedAt: 1,
      room: null,
      message: null,
    },
  ]);
  expect(JSON.stringify(result)).not.toContain("Private");
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.access).toHaveBeenCalledTimes(2);
});

import { beforeEach, expect, test, vi } from "vitest";
import { readRoomChanges } from "./changes";
import { MatrixError, type MatrixEventSchema } from "../client";
import { WorkspaceAccessDenied } from "../../workspaces/access";
import type { z } from "zod";
const mocks = vi.hoisted(() => ({
  read: vi.fn<
    (...args: unknown[]) => Promise<z.infer<typeof MatrixEventSchema>>
  >(),
  members: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("../messages", async (original) => ({
  ...(await original<typeof import("../messages")>()),
  readRoomMessage: mocks.read,
}));
vi.mock("../members", () => ({ readRoomMembers: mocks.members }));
vi.mock("../client", async (original) => ({
  ...(await original<typeof import("../client")>()),
  matrixConfiguration: async () => ({ botId: "@bot:test" }),
}));
const actor = {
  userId: "user",
  authSessionId: "session",
  workspaceId: "workspace",
};
const room = {
  id: "room",
  roomId: "!room:test",
  matrixId: "@viewer:test",
  epoch: "epoch",
  label: "Room",
  kind: "group" as const,
};
function event(id: string): z.infer<typeof MatrixEventSchema> {
  return {
    event_id: id,
    sender: "@author:test",
    type: "m.room.message",
    origin_server_ts: 1,
    content: { msgtype: "m.text", body: id },
  };
}
beforeEach(() => {
  mocks.members
    .mockReset()
    .mockResolvedValue([
      { id: "@author:test", name: "Ana", bot: false, mine: false },
    ]);
  mocks.read
    .mockReset()
    .mockImplementation(async (_room, id) => event(String(id)));
});
test("projects new messages with authorized attribution without fetching every original", async () => {
  const changes = await readRoomChanges(actor, room, [
    event("$first"),
    event("$second"),
  ]);
  expect(
    changes?.added.map((item) => [item.id, item.sender, item.text])
  ).toEqual([
    ["$first", "Ana", "$first"],
    ["$second", "Ana", "$second"],
  ]);
  expect(changes?.updated).toEqual([]);
  expect(mocks.read).not.toHaveBeenCalled();
});
test("uses the original's validated replacement, never a forged edit's supplied body", async () => {
  const forged = {
    ...event("$forged"),
    sender: "@stranger:test",
    content: {
      msgtype: "m.text",
      body: "Forged",
      "m.relates_to": { rel_type: "m.replace", event_id: "$original" },
    },
  };
  const changes = await readRoomChanges(actor, room, [forged]);
  expect(changes?.added).toEqual([]);
  expect(changes?.updated[0]).toMatchObject({
    id: "$original",
    text: "$original",
    sender: "Ana",
  });
});
test("deduplicates authoritative parent reads for several replies", async () => {
  const replies = ["$one", "$two"].map((id) => {
    const reply = event(id);
    reply.content["m.relates_to"] = { rel_type: "m.thread", event_id: "$root" };
    return reply;
  });
  mocks.read.mockResolvedValue({
    ...event("$root"),
    unsigned: { "m.relations": { "m.thread": { count: 2 } } },
  });
  const changes = await readRoomChanges(actor, room, replies);
  expect(changes?.added.map((item) => item.rootId)).toEqual(["$root", "$root"]);
  expect(changes?.updated[0]?.replies).toBe(2);
  expect(mocks.read).toHaveBeenCalledTimes(1);
});
test.each(["m.room.redaction", "m.room.member"])(
  "%s falls back to history",
  async (type) => {
    expect(
      await readRoomChanges(actor, room, [{ ...event("$state"), type }])
    ).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.members).not.toHaveBeenCalled();
  }
);
test("invalid external relations recover instead of stalling sync", async () => {
  mocks.read.mockRejectedValue(new WorkspaceAccessDenied());
  expect(
    await readRoomChanges(actor, room, [
      {
        ...event("$edit"),
        content: {
          "m.relates_to": { rel_type: "m.replace", event_id: "$not-a-message" },
        },
      },
    ])
  ).toBeNull();
});
test("rejects a cross-room event or an oversized batch before looking up members", async () => {
  await expect(
    readRoomChanges(actor, room, [
      { ...event("$wrong"), room_id: "!other:test" },
    ])
  ).rejects.toBeInstanceOf(MatrixError);
  await expect(
    readRoomChanges(
      actor,
      room,
      Array.from({ length: 21 }, (_, i) => event(`$${i}`))
    )
  ).rejects.toBeInstanceOf(MatrixError);
  expect(mocks.members).not.toHaveBeenCalled();
});

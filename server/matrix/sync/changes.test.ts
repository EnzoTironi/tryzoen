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
  native: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("../messages", async (original) => ({
  ...(await original<typeof import("../messages")>()),
  readRoomMessage: mocks.read,
}));
vi.mock("../members", () => ({ readRoomMembers: mocks.members }));
vi.mock("../client", async (original) => ({
  ...(await original<typeof import("../client")>()),
  matrixConfiguration: async () => ({ botId: "@bot:test" }),
  matrixRequest: mocks.native,
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
  workspaceId: "workspace",
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
  mocks.native.mockReset();
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

function redaction(id: string) {
  return {
    ...event("$redaction"),
    type: "m.room.redaction",
    content: { redacts: id },
  };
}
function removed(id: string, type = "m.room.message") {
  return {
    ...event(id),
    type,
    room_id: room.roomId,
    content: {},
    unsigned: { redacted_because: { event_id: "$redaction" } },
  };
}
test("removing a reaction produces an empty history delta without reading members", async () => {
  mocks.native.mockResolvedValue(removed("$reaction", "m.reaction"));
  expect(await readRoomChanges(actor, room, [redaction("$reaction")])).toEqual({
    added: [],
    updated: [],
  });
  expect(mocks.members).not.toHaveBeenCalled();
  expect(mocks.native).toHaveBeenCalledWith(
    "GET",
    "rooms/!room%3Atest/event/%24reaction",
    undefined,
    room.matrixId
  );
});
test("projects a verified message tombstone and deduplicates repeated redactions", async () => {
  mocks.native.mockResolvedValue(removed("$original"));
  const changes = await readRoomChanges(actor, room, [
    redaction("$original"),
    redaction("$original"),
  ]);
  expect(changes?.added).toEqual([]);
  expect(changes?.updated).toEqual([
    expect.objectContaining({
      id: "$original",
      redacted: true,
      text: "Mensagem removida",
    }),
  ]);
  expect(mocks.native).toHaveBeenCalledTimes(1);
});
test("accepts the top-level redaction target used by older native room versions", async () => {
  mocks.native.mockResolvedValue(removed("$original"));
  const changes = await readRoomChanges(actor, room, [
    {
      ...redaction("$unused"),
      content: {},
      redacts: "$original",
    },
  ]);
  expect(changes?.updated[0]?.id).toBe("$original");
});
test.each([
  { ...removed("$original"), room_id: "!other:test" },
  { ...removed("$original"), event_id: "$wrong" },
  { ...removed("$original"), unsigned: undefined },
  { ...removed("$original"), state_key: "" },
  removed("$original", "m.room.member"),
])(
  "recovers rather than trusting an ambiguous or unverified target",
  async (target) => {
    mocks.native.mockResolvedValue(target);
    expect(
      await readRoomChanges(actor, room, [redaction("$original")])
    ).toBeNull();
  }
);

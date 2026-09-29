import { z } from "zod";
import { beforeEach, expect, it, vi } from "vitest";
import { pollNativeSync } from "./native";
import { MatrixError, type matrixRequest } from "../client";
const mocks = vi.hoisted(() => ({ request: vi.fn<typeof matrixRequest>() }));
vi.mock("../client", async (original) => ({
  ...(await original<typeof import("../client")>()),
  matrixRequest: mocks.request,
}));
beforeEach(() => {
  mocks.request.mockReset().mockResolvedValue({ next_batch: "native-token" });
});
it("filters presence to authorized participants and strips last-seen and private status text", async () => {
  mocks.request.mockResolvedValue({
    next_batch: "next",
    presence: {
      events: [
        {
          type: "m.presence",
          sender: "@ana:test",
          content: {
            presence: "online",
            last_active_ago: 33,
            status_msg: "private detail",
          },
        },
      ],
    },
  });
  const result = await pollNativeSync(
    "@viewer:test",
    ["!room:test"],
    "previous",
    "room",
    ["@ana:test"]
  );
  expect(result.presence?.events).toEqual([
    {
      type: "m.presence",
      sender: "@ana:test",
      content: { presence: "online" },
    },
  ]);
  const url = new URL(
    mocks.request.mock.calls.at(-1)?.[1] ?? "",
    "https://matrix.invalid"
  );
  expect(JSON.parse(url.searchParams.get("filter") ?? "{}")).toMatchObject({
    presence: { senders: ["@ana:test"], limit: 100 },
  });
  await expect(
    pollNativeSync("@viewer:test", ["!room:test"], "previous", "room", [
      "@other:test",
    ])
  ).rejects.toThrow(MatrixError);
});
const connection = "776a3db7-af87-4127-a7cb-a0b3316dffec";
const position = (value: string) =>
  JSON.stringify({ connection, position: value });
it("bootstraps one isolated sliding inbox connection with a bounded room subscription", async () => {
  mocks.request.mockResolvedValue({ pos: "next" });
  await pollNativeSync("@viewer:test", ["!room:test"], null, "inbox");
  expect(mocks.request).toHaveBeenCalledWith(
    "PUT",
    "devices/ZOEN_INBOX_BRIDGE_V1",
    { display_name: "Zoen server inbox bridge" },
    "@viewer:test"
  );
  expect(mocks.request).toHaveBeenLastCalledWith(
    "POST",
    expect.stringContaining("device_id=ZOEN_INBOX_BRIDGE_V1&timeout=0"),
    expect.objectContaining({
      room_subscriptions: {
        "!room:test": {
          required_state: [["m.room.member", "$ME"]],
          timeline_limit: 1,
        },
      },
      extensions: {
        account_data: { enabled: true, lists: [], rooms: ["!room:test"] },
      },
    }),
    "@viewer:test",
    {
      version: "unstable/org.matrix.simplified_msc3575",
      maxResponseBytes: 1048576,
    }
  );
});
it("continues the same native connection without device churn and recovers expired positions once", async () => {
  mocks.request.mockResolvedValue({ pos: "next" });
  await pollNativeSync(
    "@viewer:test",
    ["!room:test"],
    position("s123&unsafe=x"),
    "inbox"
  );
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request.mock.calls[0]?.[1]).toContain("pos=s123%26unsafe%3Dx");
  expect(mocks.request.mock.calls[0]?.[2]).toMatchObject({
    conn_id: connection,
  });
  mocks.request
    .mockReset()
    .mockRejectedValueOnce(new MatrixError({ reason: "expired-position" }))
    .mockResolvedValue({ pos: "new", rooms: { "!room:test": {} } });
  const refreshed = await pollNativeSync(
    "@viewer:test",
    ["!room:test"],
    position("expired"),
    "inbox"
  );
  expect(refreshed.rooms?.join?.["!room:test"]?.timeline?.limited).toBe(true);
  expect(mocks.request).toHaveBeenCalledTimes(2);
});
it("projects private unread markers and counters without exposing unrelated account data", async () => {
  mocks.request.mockResolvedValue({
    pos: "next",
    rooms: { "!room:test": { notification_count: 2, highlight_count: 1 } },
    extensions: {
      account_data: {
        rooms: {
          "!room:test": [
            { type: "m.marked_unread", content: { unread: true } },
            { type: "private.setting", content: { secret: "discard" } },
          ],
        },
        global: [{ type: "private.global", content: { secret: "discard" } }],
      },
    },
  });
  const result = await pollNativeSync(
    "@viewer:test",
    ["!room:test"],
    position("previous"),
    "inbox"
  );
  expect(result.rooms?.join?.["!room:test"]).toMatchObject({
    unread_notifications: { notification_count: 2, highlight_count: 1 },
    account_data: {
      events: [{ type: "m.marked_unread", content: { unread: true } }],
    },
  });
  expect(JSON.stringify(result)).not.toContain("discard");
});
it.each([
  { pos: "x".repeat(3501) },
  { pos: "next", rooms: { "!other:test": {} } },
  {
    pos: "next",
    rooms: {
      "!room:test": {
        timeline: [
          { event_id: "a", type: "m.room.message" },
          { event_id: "b", type: "m.room.message" },
        ],
      },
    },
  },
  {
    pos: "next",
    extensions: { account_data: { rooms: { "!other:test": [] } } },
  },
])("rejects provider output outside the bounded scope", async (result) => {
  mocks.request.mockResolvedValue(z.json().parse(result));
  await expect(
    pollNativeSync(
      "@viewer:test",
      ["!room:test"],
      position("previous"),
      "inbox"
    )
  ).rejects.toThrow(MatrixError);
});
it("removes counters for native memberships that are no longer joined", async () => {
  mocks.request.mockResolvedValue({
    pos: "next",
    rooms: {
      "!room:test": {
        required_state: [
          {
            type: "m.room.member",
            state_key: "@viewer:test",
            content: { membership: "leave" },
          },
        ],
      },
    },
  });
  const result = await pollNativeSync(
    "@viewer:test",
    ["!room:test"],
    position("previous"),
    "inbox"
  );
  expect(result.rooms?.leave).toEqual({ "!room:test": {} });
  expect(result.rooms?.join).toEqual({});
});
it("focused room shares change signals and typing in a finite native long-poll", async () => {
  await pollNativeSync("@viewer:test", ["!room:test"], "native-cursor", "room");
  expect(mocks.request).toHaveBeenLastCalledWith(
    "GET",
    expect.stringContaining("device_id=ZOEN_ROOM_BRIDGE_V1&timeout=10000"),
    undefined,
    "@viewer:test",
    { maxResponseBytes: 2097152 }
  );
  const request = mocks.request.mock.calls[0]?.[1] ?? "";
  const filter: unknown = JSON.parse(
    new URL(request, "https://matrix.invalid/").searchParams.get("filter") ??
      "{}"
  );
  expect(filter).toMatchObject({
    event_fields: [
      "event_id",
      "type",
      "sender",
      "origin_server_ts",
      "content",
      "unsigned",
      "room_id",
      "state_key",
      "redacts",
    ],
    room: {
      rooms: ["!room:test"],
      timeline: {
        limit: 20,
        types: [
          "m.room.message",
          "m.room.redaction",
          "m.reaction",
          "m.room.member",
          "m.room.name",
          "m.room.pinned_events",
        ],
      },
      ephemeral: { types: ["m.typing"] },
    },
  });
  await expect(
    pollNativeSync("@viewer:test", ["!room:test", "!other:test"], null, "room")
  ).rejects.toThrow(MatrixError);
});

it.each(["inbox", "room"] as const)(
  "rejects a reaction event from another room in %s sync",
  async (mode) => {
    mocks.request.mockResolvedValue({
      next_batch: "next",
      rooms: {
        join: {
          "!room:test": {
            timeline: {
              events: [
                {
                  event_id: "$reaction",
                  type: "m.reaction",
                  room_id: "!other:test",
                },
              ],
            },
          },
        },
      },
    });
    await expect(
      pollNativeSync(
        "@viewer:test",
        ["!room:test"],
        mode === "inbox" ? position("previous") : "previous",
        mode
      )
    ).rejects.toThrow(MatrixError);
  }
);

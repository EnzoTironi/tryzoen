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
it("bootstraps one stable bridge device and bounds metadata responses", async () => {
  await pollNativeSync("@viewer:test", ["!room:test"], null, "inbox");
  expect(mocks.request).toHaveBeenCalledWith(
    "PUT",
    "devices/ZOEN_INBOX_BRIDGE_V1",
    { display_name: "Zoen server inbox bridge" },
    "@viewer:test"
  );
  expect(mocks.request).toHaveBeenLastCalledWith(
    "GET",
    expect.stringContaining("device_id=ZOEN_INBOX_BRIDGE_V1&timeout=0"),
    undefined,
    "@viewer:test",
    { maxResponseBytes: 1048576 }
  );
});
it("uses the exact previous native cursor without device churn", async () => {
  await pollNativeSync(
    "@viewer:test",
    ["!room:test"],
    "s123&unsafe=x",
    "inbox"
  );
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request.mock.calls[0]?.[1]).toContain("since=s123%26unsafe%3Dx");
});
it("accepts bounded native counters and consumes receipt signals without exposing participants", async () => {
  mocks.request.mockResolvedValue({
    next_batch: "receipt",
    rooms: {
      join: {
        "!room:test": {
          unread_notifications: { notification_count: 0, highlight_count: 0 },
          ephemeral: {
            events: [
              {
                type: "m.receipt",
                content: {
                  $private: {
                    "m.read.private": { "@viewer:test": { ts: 123 } },
                  },
                },
              },
            ],
          },
        },
      },
    },
  });
  const result = await pollNativeSync(
    "@viewer:test",
    ["!room:test"],
    "previous",
    "inbox"
  );
  expect(result.rooms?.join?.["!room:test"]?.unread_notifications).toEqual({
    notification_count: 0,
    highlight_count: 0,
  });
  expect(JSON.stringify(result)).not.toContain("$private");
  expect(mocks.request.mock.calls.at(-1)?.[1]).toContain(
    encodeURIComponent('"m.receipt"')
  );
  await expect(
    pollNativeSync("@viewer:test", ["!room:test"], "previous", "room")
  ).rejects.toThrow(MatrixError);
});
it.each([
  { next_batch: "x".repeat(4097) },
  {
    next_batch: "next",
    rooms: { join: { "!other:test": { timeline: { events: [] } } } },
  },
  {
    next_batch: "next",
    rooms: {
      join: {
        "!room:test": {
          timeline: {
            events: [
              { event_id: "a", type: "m.room.message" },
              { event_id: "b", type: "m.room.message" },
            ],
          },
        },
      },
    },
  },
])("rejects provider output outside the bounded scope", async (result) => {
  mocks.request.mockResolvedValue(z.json().parse(result));
  await expect(
    pollNativeSync("@viewer:test", ["!room:test"], "previous", "inbox")
  ).rejects.toThrow(MatrixError);
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
      pollNativeSync("@viewer:test", ["!room:test"], "previous", mode)
    ).rejects.toThrow(MatrixError);
  }
);

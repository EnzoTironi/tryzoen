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
it("typing uses one-room ephemeral sync and finite native long-poll", async () => {
  await pollNativeSync(
    "@viewer:test",
    ["!room:test"],
    "native-cursor",
    "typing"
  );
  expect(mocks.request).toHaveBeenLastCalledWith(
    "GET",
    expect.stringContaining("device_id=ZOEN_TYPING_BRIDGE_V1&timeout=10000"),
    undefined,
    "@viewer:test",
    { maxResponseBytes: 65536 }
  );
  const request = mocks.request.mock.calls[0]?.[1] ?? "";
  const filter: unknown = JSON.parse(
    new URL(request, "https://matrix.invalid/").searchParams.get("filter") ??
      "{}"
  );
  expect(filter).toMatchObject({
    room: {
      rooms: ["!room:test"],
      timeline: { types: [] },
      ephemeral: { types: ["m.typing"] },
    },
  });
  await expect(
    pollNativeSync(
      "@viewer:test",
      ["!room:test", "!other:test"],
      null,
      "typing"
    )
  ).rejects.toThrow(MatrixError);
});

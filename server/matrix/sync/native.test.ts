import { z } from "zod";
import { beforeEach, expect, it, vi } from "vitest";
import { pollNativeInbox } from "./native";
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
  await pollNativeInbox("@viewer:test", ["!room:test"], null);
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
  await pollNativeInbox("@viewer:test", ["!room:test"], "s123&unsafe=x");
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
    pollNativeInbox("@viewer:test", ["!room:test"], "previous")
  ).rejects.toThrow(MatrixError);
});

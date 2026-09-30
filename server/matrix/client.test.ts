import { afterEach, expect, it, vi } from "vitest";
import { matrixRequest, MatrixError, MatrixEventSchema } from "./client";
vi.mock("@shared/environment", () => ({
  env: {
    ZOEN_MATRIX_URL: "https://matrix.test",
    ZOEN_MATRIX_SERVER_NAME: "test",
    ZOEN_MATRIX_AS_TOKEN: { reveal: () => "synthetic" },
    ZOEN_MATRIX_HS_TOKEN: { reveal: () => "synthetic" },
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
});
it("limits actual streamed bytes without trusting Content-Length", async () => {
  const cancel = vi.fn<() => void>();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1025));
    },
    cancel,
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(stream, { headers: { "content-length": "1" } })
      )
  );
  await expect(
    matrixRequest("GET", "sync", undefined, "@viewer:test", {
      maxResponseBytes: 1024,
    })
  ).rejects.toThrow(MatrixError);
  expect(cancel).toHaveBeenCalled();
});
it("parses a response within the explicit byte budget", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response('{"next_batch":"token"}'))
  );
  expect(
    await matrixRequest("GET", "sync", undefined, "@viewer:test", {
      maxResponseBytes: 1024,
    })
  ).toEqual({ next_batch: "token" });
});

it("preserves native mention metadata on originals and replacements", () => {
  const mentions = { user_ids: ["@person:test"] };
  const event = MatrixEventSchema.parse({
    event_id: "$edit",
    type: "m.room.message",
    sender: "@author:test",
    content: {
      body: "* After",
      "m.mentions": { user_ids: [], room: false },
      "m.new_content": { body: "After", "m.mentions": mentions },
    },
  });
  expect(event.content["m.mentions"]).toEqual({ user_ids: [], room: false });
  expect(event.content["m.new_content"]?.["m.mentions"]).toEqual(mentions);
});

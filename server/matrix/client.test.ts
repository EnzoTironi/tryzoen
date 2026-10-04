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

it.each([
  { retry: 17000, header: undefined, expected: 17000 },
  { retry: 17000, header: "19", expected: 19000 },
  { retry: 19000, header: "17", expected: 19000 },
  { retry: undefined, header: "19", expected: 19000 },
  { retry: -1, header: "23", expected: 23000 },
  { retry: "invalid", header: "invalid", expected: 60000 },
  { retry: 0, header: undefined, expected: 1000 },
  { retry: 86_400_001, header: undefined, expected: 86_400_000 },
])(
  "retains a bounded presence retry deadline: $expected ms",
  async ({ retry, header, expected }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { errcode: "M_LIMIT_EXCEEDED", retry_after_ms: retry },
          {
            status: 429,
            headers: header ? { "retry-after": header } : undefined,
          }
        )
      )
    );
    await expect(
      matrixRequest(
        "PUT",
        "presence/%40viewer%3Atest/status",
        { presence: "online" },
        "@viewer:test"
      )
    ).rejects.toMatchObject({
      name: "MatrixRateLimitError",
      reason: "unavailable",
      retryAfterMs: expected,
    });
  }
);

it("keeps forbidden responses distinct from presence throttling", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { errcode: "M_FORBIDDEN", retry_after_ms: 1000 },
          { status: 403 }
        )
      )
  );
  const request = matrixRequest("GET", "sync");
  await expect(request).rejects.toMatchObject({
    reason: "forbidden",
  });
  await expect(request).rejects.not.toHaveProperty("retryAfterMs");
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

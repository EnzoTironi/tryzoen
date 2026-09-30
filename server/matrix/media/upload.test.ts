import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { matrixConfiguration } from "../client";
import { MatrixError } from "../client";
import { Secret } from "@shared/environment/secret";
import { withSignal, TimeoutError } from "../../operations/async";
import { uploadMatrixMedia } from "./upload";

const mocks = vi.hoisted(() => ({
  configuration: vi.fn<typeof matrixConfiguration>(),
}));
vi.mock("../client", async (original) => ({
  ...(await original<typeof import("../client")>()),
  matrixConfiguration: mocks.configuration,
}));

const fetchMock = vi.fn<typeof fetch>();
const file = {
  type: "file" as const,
  filename: "ação.bin",
  mediaType: "application/octet-stream",
  url: "data:application/octet-stream;base64,APCA/w==",
};
const userId = "@viewer:matrix.invalid";
const contentUri = "mxc://matrix.invalid/media-ID_1";

beforeEach(() => {
  mocks.configuration.mockReset().mockResolvedValue({
    url: "https://matrix.invalid",
    serverName: "matrix.invalid",
    token: new Secret("synthetic-token"),
    homeserverToken: new Secret("synthetic-homeserver-token"),
    botId: "@bot:matrix.invalid",
  });
  fetchMock
    .mockReset()
    .mockResolvedValue(Response.json({ content_uri: contentUri }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("bounded Matrix media upload", () => {
  it("preserves the binary upload, identity, timeout signal and returned format", async () => {
    const response = Response.json({ content_uri: contentUri });
    fetchMock.mockResolvedValue(response);
    await expect(uploadMatrixMedia(file, userId)).resolves.toEqual({
      url: contentUri,
      info: { mimetype: file.mediaType, size: 4 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    if (!request) throw new Error("Expected a synthetic upload");
    const [url, init] = request;
    expect(url).toBeInstanceOf(URL);
    if (!(url instanceof URL)) throw new Error("Expected a configured URL");
    expect(url.origin).toBe("https://matrix.invalid");
    expect(url.pathname).toBe("/_matrix/media/v3/upload");
    expect(url.searchParams.get("user_id")).toBe(userId);
    expect(url.searchParams.get("filename")).toBe(file.filename);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        authorization: "Bearer synthetic-token",
        "content-type": file.mediaType,
      },
      body: Buffer.from([0, 240, 128, 255]),
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(response.body?.locked).toBe(false);
  });

  it.each([
    "mxc://matrix.invalid:8448/content",
    "mxc://127.0.0.1/content",
    "mxc://[2001:db8::1]:8448/content",
  ])("accepts a well-formed content URI %s", async (uri) => {
    fetchMock.mockResolvedValue(Response.json({ content_uri: uri }));
    expect((await uploadMatrixMedia(file, userId)).url).toBe(uri);
  });

  it.each([
    "mxc://",
    "mxc:///content",
    "mxc://matrix.invalid/",
    "mxc://matrix.invalid/content/extra",
    "mxc://matrix.invalid/content?token=synthetic",
    "mxc://matrix.invalid/content#fragment",
    "mxc://user:pass@matrix.invalid/content",
    "mxc://matrix.invalid\\other/content",
    "mxc://matrix invalid/content",
    "mxc://matrix.invalid/content\n",
    "mxc://matrix.invalid:999999/content",
    "mxc://[::::]/content",
    "https://matrix.invalid/content",
  ])("rejects malformed content URI %s", async (uri) => {
    fetchMock.mockResolvedValue(Response.json({ content_uri: uri }));
    await expect(uploadMatrixMedia(file, userId)).rejects.toThrow(MatrixError);
  });

  it("rejects an oversized streamed response even without Content-Length", async () => {
    const cancel = vi.fn<() => void>();
    const bytes = new TextEncoder().encode(
      JSON.stringify({ content_uri: contentUri, extra: "x".repeat(4 * 1024) })
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
      },
      cancel,
    });
    fetchMock.mockResolvedValue(new Response(body));
    await expect(uploadMatrixMedia(file, userId)).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it("accepts the exact 4 KiB response boundary", async () => {
    const json = JSON.stringify({ content_uri: contentUri });
    fetchMock.mockResolvedValue(new Response(json.padEnd(4 * 1024, " ")));
    expect((await uploadMatrixMedia(file, userId)).url).toBe(contentUri);
  });

  it.each(["4097", "-1", "NaN", "1e3"])(
    "rejects invalid or oversized Content-Length %s before reading",
    async (length) => {
      const pending = pendingBody();
      fetchMock.mockResolvedValue(
        new Response(pending.body, { headers: { "content-length": length } })
      );
      await expect(uploadMatrixMedia(file, userId)).rejects.toThrow(
        MatrixError
      );
      expect(pending.pull).not.toHaveBeenCalled();
      expect(pending.cancel).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["", "not-json", "null", "{}", '{"content_uri":7}'])(
    "rejects an invalid response body without exposing it: %s",
    async (body) => {
      fetchMock.mockResolvedValue(new Response(body));
      await expect(uploadMatrixMedia(file, userId)).rejects.toMatchObject({
        name: "MatrixError",
        message: "MatrixError",
        reason: "unavailable",
      });
    }
  );

  it("closes a rejected response without reading its error body", async () => {
    const pending = pendingBody();
    fetchMock.mockResolvedValue(new Response(pending.body, { status: 503 }));
    await expect(uploadMatrixMedia(file, userId)).rejects.toThrow(MatrixError);
    expect(pending.pull).not.toHaveBeenCalled();
    expect(pending.cancel).toHaveBeenCalledTimes(1);
    expect(pending.body.locked).toBe(false);
  });

  it("cancels and unlocks a pending body when the caller aborts", async () => {
    const pending = pendingBody();
    fetchMock.mockResolvedValue(new Response(pending.body));
    const controller = new AbortController();
    const reason = new Error("Synthetic cancellation");
    const uploading = withSignal(controller.signal, () =>
      uploadMatrixMedia(file, userId)
    );
    await pending.reading.promise;
    const rejected = uploading.catch((cause: unknown) => cause);
    controller.abort(reason);
    expect(await rejected).toBe(reason);
    await pending.cancelled.promise;
    expect(pending.cancel).toHaveBeenCalledTimes(1);
    expect(pending.body.locked).toBe(false);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("closes a stalled body at the existing 20-second deadline", async () => {
    vi.useFakeTimers();
    const pending = pendingBody();
    fetchMock.mockResolvedValue(new Response(pending.body));
    const uploading = uploadMatrixMedia(file, userId);
    await pending.reading.promise;
    const rejected = uploading.catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await rejected).toBeInstanceOf(TimeoutError);
    expect(pending.cancel).toHaveBeenCalledTimes(1);
    expect(pending.body.locked).toBe(false);
  });

  it("closes a response arriving after cancellation without publishing its URI", async () => {
    const requested = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    fetchMock.mockImplementation(() => {
      requested.resolve();
      return response.promise;
    });
    const controller = new AbortController();
    const reason = new Error("Synthetic cancellation");
    const uploading = withSignal(controller.signal, () =>
      uploadMatrixMedia(file, userId)
    );
    await requested.promise;
    const rejected = uploading.catch((cause: unknown) => cause);
    controller.abort(reason);
    expect(await rejected).toBe(reason);
    const pending = pendingBody();
    response.resolve(new Response(pending.body));
    await pending.cancelled.promise;
    expect(pending.pull).not.toHaveBeenCalled();
    expect(pending.cancel).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch after cancellation while configuration is loading", async () => {
    const configuring = Promise.withResolvers<void>();
    const configuration =
      Promise.withResolvers<Awaited<ReturnType<typeof matrixConfiguration>>>();
    const original = await mocks.configuration();
    mocks.configuration.mockImplementation(() => {
      configuring.resolve();
      return configuration.promise;
    });
    const controller = new AbortController();
    const reason = new Error("Synthetic cancellation");
    const uploading = withSignal(controller.signal, () =>
      uploadMatrixMedia(file, userId)
    );
    await configuring.promise;
    const rejected = uploading.catch((cause: unknown) => cause);
    controller.abort(reason);
    expect(await rejected).toBe(reason);
    configuration.resolve(original);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes a network failure without automatically reuploading", async () => {
    fetchMock.mockRejectedValue(new TypeError("Synthetic network failure"));
    await expect(uploadMatrixMedia(file, userId)).rejects.toThrow(MatrixError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function pendingBody() {
  const reading = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const pull = vi.fn<() => void>(() => {
    reading.resolve();
  });
  const cancel = vi.fn<() => void>(() => {
    cancelled.resolve();
  });
  const body = new ReadableStream<Uint8Array>(
    { pull, cancel },
    { highWaterMark: 0 }
  );
  return { body, reading, cancelled, pull, cancel };
}

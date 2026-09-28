import { afterEach, expect, it, vi } from "vitest";
// Exercise the installed dependency: removing our patch must fail this regression.
import { asyncMessages } from "../node_modules/@10play/tentap-editor/src/RichText/AsyncMessages";

afterEach(() => {
  vi.useRealTimers();
});

it("releases completed bridge requests and ignores duplicate responses", async () => {
  vi.useFakeTimers();
  const message = { type: "get-json", payload: { messageId: "" } };
  const result = asyncMessages.sendAsyncMessage(message, () => {
    asyncMessages.onMessage(message.payload.messageId, { type: "doc" });
    asyncMessages.onMessage(message.payload.messageId, { type: "duplicate" });
  });
  await expect(result).resolves.toEqual({ type: "doc" });
  expect(asyncMessages.subscriptions).toEqual({});
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a missing WebView response so saving can be retried", async () => {
  vi.useFakeTimers();
  const result = asyncMessages.sendAsyncMessage(
    { type: "get-json" },
    () => undefined
  );
  vi.advanceTimersByTime(10_000);
  await expect(result).rejects.toThrow("The editor did not respond");
  expect(asyncMessages.subscriptions).toEqual({});
});

it("releases requests when posting to the WebView fails", async () => {
  vi.useFakeTimers();
  await expect(
    asyncMessages.sendAsyncMessage({ type: "get-json" }, () => {
      throw new Error("WebView is unavailable");
    })
  ).rejects.toThrow("WebView is unavailable");
  expect(asyncMessages.subscriptions).toEqual({});
  expect(vi.getTimerCount()).toBe(0);
});

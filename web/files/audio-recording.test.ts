import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { startBrowserAudioRecording } from "./audio-recording";
import { inlineAttachmentSchema } from "@zoen/companion-ui/messages";
const mocks = vi.hoisted(() => ({
  read: vi.fn<(blob: Blob) => Promise<string>>(),
}));
vi.mock("./attachments", () => ({ readFileDataUrl: mocks.read }));
let track: EventTarget & { stop: ReturnType<typeof vi.fn<() => void>> };
let documentState: EventTarget & { hidden: boolean };
let getUserMedia: ReturnType<
  typeof vi.fn<() => Promise<{ getTracks: () => (typeof track)[] }>>
>;
class FakeRecorder extends EventTarget {
  static latest: FakeRecorder;
  static isTypeSupported(type: string) {
    return type.startsWith("audio/webm");
  }
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  constructor() {
    super();
    FakeRecorder.latest = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.chunk(new Blob(["voice"]));
      this.dispatchEvent(new Event("stop"));
    });
  }
  chunk(blob: Blob) {
    const event = new Event("dataavailable");
    Object.defineProperty(event, "data", { value: blob });
    this.dispatchEvent(event);
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  track = Object.assign(new EventTarget(), { stop: vi.fn<() => void>() });
  documentState = Object.assign(new EventTarget(), { hidden: false });
  getUserMedia = vi
    .fn<() => Promise<{ getTracks: () => (typeof track)[] }>>()
    .mockResolvedValue({ getTracks: () => [track] });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("document", documentState);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  mocks.read.mockImplementation(
    async (blob) =>
      `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
test("records only audio and returns a validated local attachment after explicit stop", async () => {
  const capture = await startBrowserAudioRecording(
    new AbortController().signal,
    100
  );
  expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  expect(track.stop).not.toHaveBeenCalled();
  capture.stop();
  const file = await capture.result;
  expect(inlineAttachmentSchema.parse(file).mediaType).toBe("audio/webm");
  expect(track.stop).toHaveBeenCalledOnce();
});
test("permission denial and unsupported runtimes do not claim recording succeeded", async () => {
  getUserMedia.mockRejectedValueOnce(new Error("denied"));
  await expect(
    startBrowserAudioRecording(new AbortController().signal, 100)
  ).rejects.toThrow("Microphone access");
  vi.stubGlobal("MediaRecorder", undefined);
  await expect(
    startBrowserAudioRecording(new AbortController().signal, 100)
  ).rejects.toThrow("unavailable");
});
test("cancel during a permission prompt releases a later microphone grant", async () => {
  let allow!: (value: { getTracks: () => (typeof track)[] }) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise((resolve) => {
        allow = resolve;
      })
  );
  const signal = new AbortController();
  const pending = startBrowserAudioRecording(signal.signal, 100);
  signal.abort();
  allow({ getTracks: () => [track] });
  await expect(pending).rejects.toThrow(/abort|cancel|interrupt/iu);
  expect(track.stop).toHaveBeenCalledOnce();
});
test.each(["cancel", "background", "device", "recorder"])(
  "%s stops capture and never returns a sendable recording",
  async (reason) => {
    const controller = new AbortController();
    const capture = await startBrowserAudioRecording(controller.signal, 100);
    if (reason === "cancel") controller.abort();
    if (reason === "background") {
      documentState.hidden = true;
      documentState.dispatchEvent(new Event("visibilitychange"));
    }
    if (reason === "device") track.dispatchEvent(new Event("ended"));
    if (reason === "recorder")
      FakeRecorder.latest.dispatchEvent(new Event("error"));
    await expect(capture.result).rejects.toThrow(/abort|cancel|interrupt/iu);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(mocks.read).not.toHaveBeenCalled();
  }
);
test("enforces the byte limit before converting audio into a data URL", async () => {
  const capture = await startBrowserAudioRecording(
    new AbortController().signal,
    2
  );
  FakeRecorder.latest.chunk(new Blob(["too large"]));
  await expect(capture.result).rejects.toThrow("too large");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(track.stop).toHaveBeenCalledOnce();
});
test("the duration limit stops into local review without requiring a user stop", async () => {
  const capture = await startBrowserAudioRecording(
    new AbortController().signal,
    100
  );
  await vi.advanceTimersByTimeAsync(60000);
  expect(await capture.result).toHaveProperty("type", "file");
  expect(track.stop).toHaveBeenCalledOnce();
});
test("cancelling during encoding rejects the result and releases the device only once", async () => {
  let finishRead!: (url: string) => void;
  mocks.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      })
  );
  const controller = new AbortController();
  const capture = await startBrowserAudioRecording(controller.signal, 100);
  capture.stop();
  await Promise.resolve();
  controller.abort();
  finishRead("data:audio/webm;base64,dm9pY2U=");
  await expect(capture.result).rejects.toThrow("cancelled");
  expect(track.stop).toHaveBeenCalledOnce();
});
test("an encoding failure remains a recoverable error without retaining the microphone", async () => {
  mocks.read.mockRejectedValue(new Error("file reader failed"));
  const capture = await startBrowserAudioRecording(
    new AbortController().signal,
    100
  );
  capture.stop();
  await expect(capture.result).rejects.toThrow("could not be read");
  expect(track.stop).toHaveBeenCalledOnce();
});

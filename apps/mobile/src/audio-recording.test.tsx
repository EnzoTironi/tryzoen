import { useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { RecordingStatus } from "expo-audio";
import { useAudioRecording } from "./audio-recording.native";
const mocks = vi.hoisted(() => ({
  permission: vi.fn<() => Promise<{ granted: boolean }>>(),
  mode: vi.fn<(options: unknown) => Promise<void>>(),
  prepare: vi.fn<() => Promise<void>>(),
  record: vi.fn<() => void>(),
  stop: vi.fn<() => Promise<void>>(),
  remove: vi.fn<() => void>(),
  read: vi.fn<() => Promise<string>>(),
  stateRemove: vi.fn<() => void>(),
  state: undefined as ((value: string) => void) | undefined,
  status: undefined as ((value: RecordingStatus) => void) | undefined,
  size: 10,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => void) => {
    mocks.effects.push(effect);
  },
}));
vi.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: mocks.permission,
  setAudioModeAsync: mocks.mode,
  useAudioRecorder: (
    _options: unknown,
    callback: (value: RecordingStatus) => void
  ) => {
    mocks.status = callback;
    return {
      uri: "file:///cache/voice.m4a",
      prepareToRecordAsync: mocks.prepare,
      record: mocks.record,
      stop: mocks.stop,
    };
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_name: string, callback: (value: string) => void) => {
      mocks.state = callback;
      return { remove: mocks.stateRemove };
    },
  },
}));
vi.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache" } },
  File: class {
    exists = true;
    get size() {
      return mocks.size;
    }
    base64 = mocks.read;
    delete = mocks.remove;
  },
}));
function adapter() {
  let start!: ReturnType<typeof useAudioRecording>;
  function Capture() {
    const recording = useAudioRecording();
    useEffect(() => {
      start = recording;
    }, [recording]);
    return null;
  }
  renderToStaticMarkup(<Capture />);
  for (const effect of mocks.effects.splice(0)) effect();
  return start;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.size = 10;
  mocks.permission.mockResolvedValue({ granted: true });
  mocks.prepare.mockResolvedValue(undefined);
  mocks.mode.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue(undefined);
  mocks.read.mockResolvedValue("dm9pY2U=");
});
afterEach(() => vi.useRealTimers());
test("native recording returns local audio only on stop and clears its temporary file", async () => {
  const capture = await adapter()(new AbortController().signal, 100);
  expect(mocks.record).toHaveBeenCalledOnce();
  expect(mocks.read).not.toHaveBeenCalled();
  capture.stop();
  expect(await capture.result).toMatchObject({
    type: "file",
    mediaType: "audio/mp4",
    url: "data:audio/mp4;base64,dm9pY2U=",
  });
  await Promise.resolve();
  expect(mocks.remove).toHaveBeenCalledOnce();
  expect(mocks.stateRemove).toHaveBeenCalledOnce();
  expect(mocks.mode).toHaveBeenLastCalledWith({ allowsRecording: false });
});
test("denied permission never starts recording", async () => {
  mocks.permission.mockResolvedValue({ granted: false });
  await expect(adapter()(new AbortController().signal, 100)).rejects.toThrow(
    "Microphone access"
  );
  expect(mocks.record).not.toHaveBeenCalled();
});
test.each(["cancel", "background", "interruption"])(
  "native %s discards without attaching",
  async (reason) => {
    const controller = new AbortController();
    const capture = await adapter()(controller.signal, 100);
    if (reason === "cancel") controller.abort();
    if (reason === "background") mocks.state?.("background");
    if (reason === "interruption")
      mocks.status?.({
        id: "recording",
        isFinished: true,
        hasError: false,
        error: null,
        url: null,
      });
    await expect(capture.result).rejects.toThrow(/abort|cancel|interrupt/iu);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledOnce();
  }
);
test("native oversized files are rejected before base64 loading", async () => {
  const capture = await adapter()(new AbortController().signal, 5);
  capture.stop();
  await expect(capture.result).rejects.toThrow("too large");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledOnce();
});
test("native cancellation during preparation does not start recording", async () => {
  const controller = new AbortController();
  mocks.prepare.mockImplementation(async () => {
    controller.abort();
  });
  await expect(adapter()(controller.signal, 100)).rejects.toThrow(
    /abort|cancel|interrupt/iu
  );
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.mode).toHaveBeenLastCalledWith({ allowsRecording: false });
});
test("supports native AbortSignal without the newer throwIfAborted method", async () => {
  const controller = new AbortController();
  Object.defineProperty(controller.signal, "throwIfAborted", {
    value: undefined,
  });
  const capture = await adapter()(controller.signal, 100);
  capture.stop();
  await expect(capture.result).resolves.toHaveProperty(
    "mediaType",
    "audio/mp4"
  );
});

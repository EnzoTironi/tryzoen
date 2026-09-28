import type { FileUIPart } from "ai";

/** Recording stays local until the person attaches it and explicitly sends. */
export type StartAudioRecording = (
  signal: AbortSignal,
  maxBytes: number
) => Promise<{
  stop: () => void;
  result: Promise<FileUIPart>;
}>;
export const audioRecordingLimitSeconds = 60;

/** React Native's abort-controller polyfill does not expose throwIfAborted. */
export function requireActiveAudioRecording(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Recording cancelled.");
}

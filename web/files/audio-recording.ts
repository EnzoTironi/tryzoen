import type { FileUIPart } from "ai";
import {
  audioRecordingLimitSeconds,
  requireActiveAudioRecording,
  type StartAudioRecording,
} from "@zoen/companion-ui/recording";
import { readFileDataUrl } from "./attachments";

export const startBrowserAudioRecording: StartAudioRecording = async (
  signal,
  maxBytes
) => {
  if (!("mediaDevices" in navigator) || typeof MediaRecorder === "undefined")
    throw new Error(
      "Audio recording is unavailable in this browser. You can attach an audio file instead."
    );
  if (maxBytes <= 0)
    throw new Error("Remove an attachment before recording audio.");
  requireActiveAudioRecording(signal);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
  } catch {
    throw new Error(
      "Microphone access was not granted. Check your device permissions and try again."
    );
  }
  if (signal.aborted) {
    for (const track of stream.getTracks()) track.stop();
    requireActiveAudioRecording(signal);
  }
  let recorder: MediaRecorder;
  try {
    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType)
      throw new Error("This browser cannot record a supported audio format.");
    recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 64000,
    });
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw error;
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  let stopped = false;
  let settled = false;
  let released = false;
  let timer: ReturnType<typeof setTimeout>;
  let resolve!: (file: FileUIPart) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<FileUIPart>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // The caller receives this promise after device preparation; avoid a same-tick unhandled rejection.
  void result.catch(() => undefined);
  const cleanup = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    document.removeEventListener("visibilitychange", visibility);
    for (const track of stream.getTracks()) {
      track.removeEventListener("ended", interrupted);
      track.stop();
    }
  };
  const fail = (message: string) => {
    if (settled) return;
    settled = true;
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* Stopping all tracks below still releases the microphone. */
    }
    chunks.length = 0;
    cleanup();
    reject(new Error(message));
  };
  const cancel = () => {
    fail("Recording cancelled.");
  };
  const interrupted = () => {
    fail("Recording was interrupted. Please record your message again.");
  };
  const visibility = () => {
    if (document.hidden) interrupted();
  };
  const stop = () => {
    if (settled || stopped) return;
    stopped = true;
    clearTimeout(timer);
    if (recorder.state !== "inactive") recorder.stop();
  };
  recorder.addEventListener("dataavailable", (event) => {
    if (settled) return;
    bytes += event.data.size;
    if (bytes > maxBytes) {
      fail("This recording is too large. Try a shorter message.");
      return;
    }
    chunks.push(event.data);
  });
  recorder.addEventListener("error", interrupted);
  recorder.addEventListener("stop", () => {
    if (settled) return;
    if (!stopped) {
      interrupted();
      return;
    }
    cleanup();
    if (!bytes) {
      fail("No audio was captured. Please try again.");
      return;
    }
    const mediaType = recorder.mimeType.split(";")[0] ?? "audio/webm";
    const blob = new Blob(chunks, { type: mediaType });
    chunks.length = 0;
    void readFileDataUrl(blob).then(
      (url) => {
        if (settled) return;
        if (signal.aborted) {
          fail("Recording cancelled.");
          return;
        }
        settled = true;
        resolve({
          type: "file",
          filename: `Voice message.${mediaType === "audio/mp4" ? "m4a" : mediaType === "audio/ogg" ? "ogg" : "webm"}`,
          mediaType,
          url,
        });
      },
      () => {
        fail("The recording could not be read. Please try again.");
      }
    );
  });
  signal.addEventListener("abort", cancel, { once: true });
  document.addEventListener("visibilitychange", visibility);
  for (const track of stream.getTracks())
    track.addEventListener("ended", interrupted);
  try {
    recorder.start(250);
    timer = setTimeout(stop, audioRecordingLimitSeconds * 1000);
    if (signal.aborted) cancel();
    if (document.hidden) interrupted();
  } catch {
    fail("The microphone could not start. Please try again.");
  }
  return { stop, result };
};

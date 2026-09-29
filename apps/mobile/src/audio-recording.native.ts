import { useCallback, useRef } from "react";
import { AppState } from "react-native";
import { File, Paths } from "expo-file-system";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import type { FileUIPart } from "ai";
import {
  audioRecordingLimitSeconds,
  requireActiveAudioRecording,
  type StartAudioRecording,
} from "@zoen/companion-ui/recording";

export function useAudioRecording(): StartAudioRecording {
  const active = useRef<{ interrupt: () => void }>(undefined);
  const preparing = useRef(false);
  const recorder = useAudioRecorder(
    { ...RecordingPresets.HIGH_QUALITY, bitRate: 64000, numberOfChannels: 1 },
    (status) => {
      if (status.hasError || status.mediaServicesDidReset || status.isFinished)
        active.current?.interrupt();
    }
  );
  return useCallback(
    async (signal, maxBytes) => {
      if (preparing.current || active.current)
        throw new Error("The microphone is still closing. Try again.");
      if (maxBytes <= 0)
        throw new Error("Remove an attachment before recording audio.");
      requireActiveAudioRecording(signal);
      const removeFile = () => {
        const uri = recorder.uri;
        if (uri?.startsWith(`${Paths.cache.uri.replace(/\/$/u, "")}/`)) {
          const temporary = new File(uri);
          if (temporary.exists) temporary.delete();
        }
      };
      preparing.current = true;
      try {
        const permission = await requestRecordingPermissionsAsync();
        requireActiveAudioRecording(signal);
        if (!permission.granted)
          throw new Error(
            "Microphone access was not granted. Enable it in your device settings to record."
          );
        await setAudioModeAsync({
          allowsRecording: true,
          shouldPlayInBackground: false,
        });
        await recorder.prepareToRecordAsync();
        requireActiveAudioRecording(signal);
      } catch (error) {
        try {
          await recorder.stop();
        } catch {
          /* Preparation may not have opened the microphone. */
        }
        try {
          removeFile();
        } catch {
          console.warn("Could not remove a temporary audio recording.");
        }
        await setAudioModeAsync({ allowsRecording: false }).catch(
          () => undefined
        );
        preparing.current = false;
        throw error;
      }
      preparing.current = false;
      let finished = false;
      let resolve!: (file: FileUIPart) => void;
      let reject!: (error: Error) => void;
      const result = new Promise<FileUIPart>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      void result.catch(() => undefined);
      let timer: ReturnType<typeof setTimeout>;
      const finish = async (reason?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        state.remove();
        try {
          await recorder.stop();
          if (reason || signal.aborted)
            throw new Error(reason ?? "Recording cancelled.");
          if (!recorder.uri)
            throw new Error("No audio was captured. Please try again.");
          const file = new File(recorder.uri);
          if (!file.size || file.size > maxBytes)
            throw new Error(
              "This recording is empty or too large. Try a shorter message."
            );
          const url = `data:audio/mp4;base64,${await file.base64()}`;
          requireActiveAudioRecording(signal);
          resolve({
            type: "file",
            filename: "Voice message.m4a",
            mediaType: "audio/mp4",
            url,
          });
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error("Recording failed. Please try again.")
          );
        } finally {
          try {
            removeFile();
          } catch {
            console.warn("Could not remove a temporary audio recording.");
          }
          await setAudioModeAsync({ allowsRecording: false }).catch(
            () => undefined
          );
          active.current = undefined;
        }
      };
      const cancel = () => {
        void finish("Recording cancelled.");
      };
      const interrupt = () => {
        void finish(
          "Recording was interrupted. Please record your message again."
        );
      };
      const state = AppState.addEventListener("change", (value) => {
        if (value !== "active") interrupt();
      });
      active.current = { interrupt };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        recorder.record();
        timer = setTimeout(() => {
          void finish();
        }, audioRecordingLimitSeconds * 1000);
        if (signal.aborted) cancel();
        if (AppState.currentState !== "active") interrupt();
      } catch {
        interrupt();
      }
      return {
        result,
        stop: () => {
          void finish();
        },
      };
    },
    [recorder]
  );
}

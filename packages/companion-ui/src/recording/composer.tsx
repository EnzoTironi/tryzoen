import {
  useEffect,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Square, Trash2 } from "lucide-react-native";
import type { FileUIPart } from "ai";
import { useAttachments } from "../attachments/provider";
import { IconButton } from "../icon-button";
import { ActionButton } from "../button";
import { colors } from "../theme";
import {
  audioRecordingLimitSeconds,
  requireActiveAudioRecording,
} from "./schema";

export interface AudioRecorderHandle {
  start: () => void;
}

export function AudioMessageRecorder({
  triggerRef,
  disabled,
  maxBytes,
  onAttach,
  onActive,
}: {
  readonly triggerRef: Ref<AudioRecorderHandle>;
  readonly disabled: boolean;
  readonly maxBytes: number;
  readonly onAttach: (file: FileUIPart) => void;
  readonly onActive: (active: boolean) => void;
}) {
  const adapter = useAttachments();
  const [phase, setPhase] = useState<
    "idle" | "permission" | "recording" | "processing" | "review"
  >("idle");
  const [file, setFile] = useState<FileUIPart>();
  const [error, setError] = useState<string>();
  const [seconds, setSeconds] = useState(0);
  const operation = useRef<AbortController>(undefined);
  const stop = useRef<() => void>(undefined);
  useEffect(
    () => () => {
      operation.current?.abort();
    },
    []
  );
  useEffect(() => {
    if (phase !== "recording") return undefined;
    const began = Date.now();
    const timer = setInterval(() => {
      setSeconds(
        Math.min(
          audioRecordingLimitSeconds,
          Math.floor((Date.now() - began) / 1000)
        )
      );
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [phase]);
  const reset = useCallback(() => {
    operation.current?.abort();
    operation.current = undefined;
    stop.current = undefined;
    setFile(undefined);
    setPhase("idle");
    onActive(false);
  }, [onActive]);
  useEffect(() => {
    if (disabled && operation.current) reset();
  }, [disabled, reset]);
  async function record() {
    if (!adapter?.startAudioRecording || operation.current || disabled) return;
    const controller = new AbortController();
    operation.current = controller;
    setError(undefined);
    setSeconds(0);
    setPhase("permission");
    onActive(true);
    try {
      const recording = await adapter.startAudioRecording(
        controller.signal,
        maxBytes
      );
      if (controller.signal.aborted) return;
      stop.current = recording.stop;
      setPhase("recording");
      const audio = await recording.result;
      requireActiveAudioRecording(controller.signal);
      setFile(audio);
      setPhase("review");
    } catch (cause) {
      if (controller.signal.aborted) return;
      reset();
      setError(
        cause instanceof Error
          ? cause.message
          : "Recording failed. Please try again."
      );
    }
  }
  useImperativeHandle(triggerRef, () => ({
    start: () => {
      void record();
    },
  }));
  if (!adapter?.startAudioRecording || (phase === "idle" && !error))
    return null;
  return (
    <View style={styles.panel}>
      {phase !== "idle" && (
        <>
          <View style={styles.controls}>
            {phase === "permission" || phase === "processing" ? (
              <ActivityIndicator
                accessibilityLabel={
                  phase === "permission"
                    ? "Waiting for microphone permission"
                    : "Preparing recording"
                }
              />
            ) : null}
            {phase === "recording" && (
              <>
                <View style={styles.dot} />
                <Text style={styles.label}>
                  Recording {seconds}s / {audioRecordingLimitSeconds}s
                </Text>
                <IconButton
                  icon={Square}
                  label="Stop recording and review"
                  onPress={() => {
                    setPhase("processing");
                    stop.current?.();
                  }}
                />
              </>
            )}
            {phase === "permission" && (
              <Text style={styles.label}>
                Allow microphone access to record.
              </Text>
            )}
            <IconButton
              icon={Trash2}
              label="Discard recording"
              onPress={reset}
            />
          </View>
          {phase === "review" && file && (
            <>
              {adapter.renderMedia?.(file)}
              <ActionButton
                disabled={disabled}
                onPress={() => {
                  try {
                    onAttach(file);
                    reset();
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "The recording could not be attached."
                    );
                  }
                }}
              >
                Attach voice message
              </ActionButton>
              <Text style={styles.hint}>
                Listen first. Nothing is sent until you tap Send.
              </Text>
            </>
          )}
        </>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { gap: 8 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger },
  label: { fontSize: 14, color: colors.ink },
  hint: { fontSize: 12, color: colors.muted },
  error: { fontSize: 13, color: colors.danger },
});

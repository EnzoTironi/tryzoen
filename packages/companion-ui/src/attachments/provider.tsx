import type { StartAudioRecording } from "../recording/schema";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { FileUIPart } from "ai";

const Attachments = createContext<
  | {
      readonly pick: () => Promise<FileUIPart[]>;
      readonly save: (file: FileUIPart) => Promise<void>;
      readonly renderMedia?: (file: FileUIPart) => ReactNode;
      readonly startAudioRecording?: StartAudioRecording;
    }
  | undefined
>(undefined);

export function AttachmentProvider({
  pick,
  save,
  renderMedia,
  startAudioRecording,
  children,
}: {
  readonly pick: () => Promise<FileUIPart[]>;
  readonly save: (file: FileUIPart) => Promise<void>;
  readonly renderMedia?: (file: FileUIPart) => ReactNode;
  readonly startAudioRecording?: StartAudioRecording;
  readonly children: ReactNode;
}) {
  const value = useMemo(
    () => ({ pick, save, renderMedia, startAudioRecording }),
    [pick, save, renderMedia, startAudioRecording]
  );
  return <Attachments value={value}>{children}</Attachments>;
}

export function useAttachments() {
  return useContext(Attachments);
}

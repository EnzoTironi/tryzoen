import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { FileUIPart } from "ai";

const Attachments = createContext<
  | {
      readonly pick: () => Promise<FileUIPart[]>;
      readonly save: (file: FileUIPart) => Promise<void>;
    }
  | undefined
>(undefined);

export function AttachmentProvider({
  pick,
  save,
  children,
}: {
  readonly pick: () => Promise<FileUIPart[]>;
  readonly save: (file: FileUIPart) => Promise<void>;
  readonly children: ReactNode;
}) {
  const value = useMemo(() => ({ pick, save }), [pick, save]);
  return <Attachments value={value}>{children}</Attachments>;
}

export function useAttachments() {
  return useContext(Attachments);
}

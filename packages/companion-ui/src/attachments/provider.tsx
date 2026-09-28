import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { FileUIPart } from "ai";

const Attachments = createContext<
  | {
      readonly pick: () => Promise<FileUIPart[]>;
      readonly save: (file: FileUIPart) => Promise<void>;
      readonly renderMedia?: (file: FileUIPart) => ReactNode;
    }
  | undefined
>(undefined);

export function AttachmentProvider({
  pick,
  save,
  renderMedia,
  children,
}: {
  readonly pick: () => Promise<FileUIPart[]>;
  readonly save: (file: FileUIPart) => Promise<void>;
  readonly renderMedia?: (file: FileUIPart) => ReactNode;
  readonly children: ReactNode;
}) {
  const value = useMemo(
    () => ({ pick, save, renderMedia }),
    [pick, save, renderMedia]
  );
  return <Attachments value={value}>{children}</Attachments>;
}

export function useAttachments() {
  return useContext(Attachments);
}

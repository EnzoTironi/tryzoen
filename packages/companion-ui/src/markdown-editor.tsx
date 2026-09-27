import { createContext, type ReactNode, type Ref } from "react";

export interface MarkdownEditorHandle {
  read: () => Promise<string>;
}
export interface MarkdownEditorProps {
  readonly initialMarkdown: string;
  readonly label: string;
  readonly description: string;
  readonly editable: boolean;
  readonly onChange: (markdown: string) => void;
  readonly onDirty: () => void;
  readonly onError: (message: string) => void;
  readonly ref: Ref<MarkdownEditorHandle>;
}
export const MarkdownEditorProvider = createContext<
  ((props: MarkdownEditorProps) => ReactNode) | undefined
>(undefined);

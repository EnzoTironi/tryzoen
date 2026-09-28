import { createContext, type Ref, type ComponentType } from "react";
import type { z } from "zod";
import type {
  composerReferenceSchema,
  referenceAt,
} from "../references/schema";

export interface ComposerEditorHandle {
  focus: () => void;
  read?: () => Promise<string>;
  insertText?: (text: string) => void;
  insertReference?: (item: z.infer<typeof composerReferenceSchema>) => void;
}
export interface ComposerEditorProps {
  value: string;
  label: string;
  placeholder: string;
  disabled: boolean;
  maxLength: number;
  onChange: (markdown: string) => void;
  onReference: (query: ReturnType<typeof referenceAt>) => void;
  onKey: (key: string) => boolean;
  onSubmit: () => void;
  onError: (message: string) => void;
  ref: Ref<ComposerEditorHandle>;
}
export const ComposerEditorProvider = createContext<
  { Input: ComponentType<ComposerEditorProps> } | undefined
>(undefined);

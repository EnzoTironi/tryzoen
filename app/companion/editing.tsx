"use client";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import {
  CompanionOverlayProvider,
  GesturePreferenceProvider,
  MarkdownEditorProvider,
  ComposerEditorProvider,
  type ComposerEditorProps,
  type MarkdownEditorProps,
} from "@zoen/companion-ui";
import { browserGestureStorage } from "@web/components/companion-gesture-storage";
import { renderWebCompanionOverlay } from "./overlay";

const RichTextEditor = dynamic(
  () => import("@web/components/markdown-editor/rich-text"),
  { ssr: false }
);
const PromptEditor = dynamic(
  () => import("@web/components/markdown-editor/composer"),
  { ssr: false }
);
function renderComposer(props: ComposerEditorProps) {
  return <PromptEditor {...props} />;
}
function renderEditor(props: MarkdownEditorProps) {
  return <RichTextEditor {...props} />;
}

const composerAdapter = { Input: renderComposer };

export function CompanionEditingProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <GesturePreferenceProvider storage={browserGestureStorage}>
      <CompanionOverlayProvider renderOverlay={renderWebCompanionOverlay}>
        <MarkdownEditorProvider value={renderEditor}>
          <ComposerEditorProvider value={composerAdapter}>
            {children}
          </ComposerEditorProvider>
        </MarkdownEditorProvider>
      </CompanionOverlayProvider>
    </GesturePreferenceProvider>
  );
}

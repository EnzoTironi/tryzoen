"use client";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import {
  CompanionOverlayProvider,
  MarkdownEditorProvider,
  type MarkdownEditorProps,
} from "@zoen/companion-ui";
import { renderWebCompanionOverlay } from "./overlay";

const RichTextEditor = dynamic(
  () => import("@web/components/markdown-editor/rich-text"),
  { ssr: false }
);
function renderEditor(props: MarkdownEditorProps) {
  return <RichTextEditor {...props} />;
}

export function CompanionEditingProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <CompanionOverlayProvider renderOverlay={renderWebCompanionOverlay}>
      <MarkdownEditorProvider value={renderEditor}>
        {children}
      </MarkdownEditorProvider>
    </CompanionOverlayProvider>
  );
}

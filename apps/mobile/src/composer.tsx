import type { ComposerEditorProps } from "@zoen/companion-ui";
import PromptEditor from "../../../web/components/markdown-editor/composer";
export function renderComposerEditor(props: ComposerEditorProps) {
  return <PromptEditor {...props} />;
}

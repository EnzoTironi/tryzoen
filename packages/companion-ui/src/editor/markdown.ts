import { MarkdownManager } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";

export const documentExtensions = [
  StarterKit.configure({
    link: { openOnClick: false, autolink: false },
    underline: false,
  }),
];
export const documentMarkdown = new MarkdownManager({
  extensions: documentExtensions,
});

/** Keep unsupported source intact instead of silently dropping its nodes. */
export function needsSourceEditor(markdown: string, native = false) {
  let unsupported = false;
  void documentMarkdown.instance.walkTokens(
    documentMarkdown.instance.lexer(markdown),
    (token) => {
      if (
        ["html", "image", "table"].includes(token.type) ||
        (token.type === "list_item" && token.task) ||
        (native && (token.type === "code" || token.type === "hr"))
      )
        unsupported = true;
    }
  );
  return unsupported;
}

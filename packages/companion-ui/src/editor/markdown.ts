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
  // Identity fields occupy separate lines even inside one Markdown paragraph.
  markedOptions: { breaks: true, gfm: true },
});

/** Keep unsupported source intact instead of silently dropping its nodes. */
export function needsSourceEditor(markdown: string, native = false) {
  // YAML/TOML frontmatter is operational skill metadata, not document prose.
  if (/^(?:\uFEFF)?(?:---|\+\+\+)\r?\n/u.test(markdown)) return true;
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

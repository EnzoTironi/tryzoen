import { shareFile } from "../files/share";

export async function shareMarkdown(text: string, filename = "document.md") {
  await shareFile(text, {
    filename: `${filename.replace(/\.md$/iu, "") || "document"}.md`,
    mediaType: "text/markdown",
  });
}

import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";

export async function shareMarkdown(text: string, filename = "document.md") {
  if (!(await isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  const directory = new Directory(Paths.cache, `document-${randomUUID()}`);
  directory.create();
  try {
    const name = filename.replace(/[/\\\p{Cc}]/gu, "-").replace(/\.md$/iu, "");
    const file = new File(directory, `${name || "document"}.md`);
    file.create();
    file.write(text);
    await shareAsync(file.uri, {
      mimeType: "text/markdown",
      UTI: "net.daringfireball.markdown",
      dialogTitle: "Save or share Markdown",
    });
  } finally {
    directory.delete();
  }
}

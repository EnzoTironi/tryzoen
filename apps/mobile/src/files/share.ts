import { catalogs, createTranslator } from "@zoen/companion-ui/i18n";
import { deviceLocale, readLocalePreference } from "../locale";
import { randomUUID } from "expo-crypto";
import {
  Directory,
  File,
  Paths,
  type FileWriteOptions,
} from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";

export async function shareFile(
  content: string,
  {
    filename,
    mediaType,
    encoding,
  }: {
    readonly filename: string;
    readonly mediaType: string;
    readonly encoding?: FileWriteOptions["encoding"];
  }
) {
  if (!(await isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  const locale =
    (await readLocalePreference().catch(() => undefined)) ?? deviceLocale();
  const t = createTranslator(catalogs[locale], locale);
  const directory = new Directory(Paths.cache, `document-${randomUUID()}`);
  directory.create();
  try {
    const name = filename.replace(/[/\\\p{Cc}]/gu, "-");
    const file = new File(
      directory,
      name === "." || name === ".." || !name ? "attachment" : name
    );
    file.create();
    file.write(content, { encoding });
    await shareAsync(file.uri, {
      mimeType: mediaType,
      ...(mediaType === "text/markdown"
        ? { UTI: "net.daringfireball.markdown" }
        : {}),
      dialogTitle: t("Save or share file"),
    });
  } finally {
    try {
      directory.delete();
    } catch {
      console.warn("Could not remove a temporary shared file.");
    }
  }
}

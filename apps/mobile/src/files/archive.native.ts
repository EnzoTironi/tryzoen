import { catalogs, createTranslator } from "@zoen/companion-ui/i18n";
import { deviceLocale, readLocalePreference } from "../locale";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { apiOrigin } from "../environment";
import { accountHeaders } from "../auth";

export async function sharePrivateArchive(input: {
  path: string;
  filename: string;
  mimeType: string;
  title: string;
}) {
  if (!(await isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  const locale =
    (await readLocalePreference().catch(() => undefined)) ?? deviceLocale();
  const t = createTranslator(catalogs[locale], locale);
  const directory = new Directory(Paths.cache, `archive-${randomUUID()}`);
  directory.create();
  try {
    const file = await File.downloadFileAsync(
      new URL(input.path, apiOrigin).href,
      new File(directory, input.filename),
      { headers: await accountHeaders() }
    );
    await shareAsync(file.uri, {
      mimeType: input.mimeType,
      dialogTitle: t(input.title),
    });
  } catch {
    throw new Error(
      "Couldn’t export the archive. Check your connection and try again."
    );
  } finally {
    try {
      directory.delete();
    } catch {
      console.warn("Could not remove a temporary private export.");
    }
  }
}

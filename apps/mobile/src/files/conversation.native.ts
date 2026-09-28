import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { apiOrigin } from "../environment";
import { accountHeaders } from "../auth";

export async function exportConversation(sessionId: string) {
  if (!(await isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  const directory = new Directory(Paths.cache, `conversation-${randomUUID()}`);
  directory.create();
  try {
    const url = new URL(
      `/api/conversations/${encodeURIComponent(sessionId)}/archive`,
      apiOrigin
    );
    const file = await File.downloadFileAsync(
      url.href,
      new File(directory, "zoen-conversation.jsonl"),
      { headers: await accountHeaders() }
    );
    await shareAsync(file.uri, {
      mimeType: "application/x-ndjson",
      dialogTitle: "Save conversation archive",
    });
  } catch {
    throw new Error(
      "Couldn’t export the conversation archive. It may not have been saved yet. Try again."
    );
  } finally {
    try {
      directory.delete();
    } catch {
      console.warn("Could not remove a temporary conversation export.");
    }
  }
}

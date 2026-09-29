import { sharePrivateArchive } from "./archive.native";

export const exportConversation = (sessionId: string) =>
  sharePrivateArchive({
    path: `/api/conversations/${encodeURIComponent(sessionId)}/archive`,
    filename: "zoen-conversation.jsonl",
    mimeType: "application/x-ndjson",
    title: "Save conversation archive",
  });

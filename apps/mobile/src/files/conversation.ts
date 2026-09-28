import { downloadConversationArchive } from "@web/files/download";
import { apiOrigin } from "../environment";

export const exportConversation = (sessionId: string) =>
  downloadConversationArchive(apiOrigin, sessionId);

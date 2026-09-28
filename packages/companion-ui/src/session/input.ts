import type { UserContent } from "ai";
import { z } from "zod";
import { inlineAttachmentSchema } from "../attachments/schema";
import { readReplyMessage } from "./reply";
import { attachmentLimits, inlineAttachmentBytes } from "../attachments/limits";

export const conversationDraftSchema = z
  .object({
    text: z.string().max(10000),
    files: z.array(inlineAttachmentSchema).max(attachmentLimits.count),
  })
  .refine(
    (draft) =>
      draft.files.reduce(
        (total, file) => total + inlineAttachmentBytes(file.url),
        0
      ) <= attachmentLimits.bytes
  );

export type ConversationDraft = z.infer<typeof conversationDraftSchema>;

export function messageContent(message: ConversationDraft) {
  conversationDraftSchema.parse(message);
  const text = message.text.trim();
  if (message.files.length === 0) return text;
  const parts: UserContent = [];
  if (text) parts.push({ type: "text", text });
  for (const file of message.files) {
    parts.push({
      type: "file",
      data: file.url,
      filename: file.filename,
      mediaType: file.mediaType,
    });
  }
  return parts;
}

export function chatTitle(message: ConversationDraft) {
  const text = message.text.trim();
  const quoted = readReplyMessage(text);
  if (quoted)
    return (quoted.text.length > 0 ? quoted.text : quoted.quote).slice(0, 240);
  if (text) return text.slice(0, 240);
  return message.files[0]?.filename?.slice(0, 240) ?? "New chat";
}

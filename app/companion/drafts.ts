import { z } from "zod";
import {
  conversationDraftSchema,
  type ConversationDraft,
} from "@zoen/companion-ui/messages";

const draftSchema = z.object({
  token: z.uuid(),
  message: conversationDraftSchema,
});

/** One pending handoff per account/workspace in this tab, never in the URL. */
export function writeConversationDraft(
  scope: string,
  message: ConversationDraft
) {
  const draft = draftSchema.parse({ token: crypto.randomUUID(), message });
  sessionStorage.setItem(`companion-draft:${scope}`, JSON.stringify(draft));
  return draft.token;
}

export function readConversationDraft(scope: string, token: string | null) {
  if (!token) return undefined;
  try {
    const stored = sessionStorage.getItem(`companion-draft:${scope}`);
    const result = draftSchema.safeParse(stored ? JSON.parse(stored) : null);
    return result.success && result.data.token === token
      ? result.data.message
      : undefined;
  } catch {
    return undefined;
  }
}

export function forgetConversationDraft(scope: string, token: string | null) {
  if (token && readConversationDraft(scope, token)) {
    sessionStorage.removeItem(`companion-draft:${scope}`);
  }
}

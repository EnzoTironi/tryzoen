import { z } from "zod";

const draftSchema = z.object({
  token: z.uuid(),
  text: z.string().max(10000),
});

/** One pending handoff per account/workspace in this tab, never in the URL. */
export function writeConversationDraft(scope: string, text: string) {
  const draft = draftSchema.parse({ token: crypto.randomUUID(), text });
  sessionStorage.setItem(`companion-draft:${scope}`, JSON.stringify(draft));
  return draft.token;
}

export function readConversationDraft(scope: string, token: string | null) {
  if (!token) return "";
  try {
    const stored = sessionStorage.getItem(`companion-draft:${scope}`);
    const result = draftSchema.safeParse(stored ? JSON.parse(stored) : null);
    return result.success && result.data.token === token
      ? result.data.text
      : "";
  } catch {
    return "";
  }
}

export function forgetConversationDraft(scope: string, token: string | null) {
  if (token && readConversationDraft(scope, token)) {
    sessionStorage.removeItem(`companion-draft:${scope}`);
  }
}

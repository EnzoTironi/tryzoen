import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  forgetConversationDraft,
  readConversationDraft,
  writeConversationDraft,
} from "@app/companion/drafts";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("hands off text only inside its account/workspace and consumes the matching token", () => {
  const token = writeConversationDraft(
    "account-a/workspace-a",
    "Private reading note"
  );
  expect(token).not.toContain("Private");
  expect(readConversationDraft("account-a/workspace-a", token)).toBe(
    "Private reading note"
  );
  expect(readConversationDraft("account-b/workspace-a", token)).toBe("");
  expect(readConversationDraft("account-a/workspace-b", token)).toBe("");
  const replacement = writeConversationDraft(
    "account-a/workspace-a",
    "New note"
  );
  forgetConversationDraft("account-a/workspace-a", token);
  expect(readConversationDraft("account-a/workspace-a", replacement)).toBe(
    "New note"
  );
  expect(readConversationDraft("account-a/workspace-a", token)).toBe("");
  forgetConversationDraft("account-a/workspace-a", replacement);
  expect(readConversationDraft("account-a/workspace-a", replacement)).toBe("");
});

it("does not accept arbitrary URL text and reports failure to store a new draft", () => {
  expect(readConversationDraft("scope", "Private text in URL")).toBe("");
  vi.stubGlobal("sessionStorage", {
    getItem: () => {
      throw new Error("Unavailable");
    },
    setItem: () => {
      throw new Error("Unavailable");
    },
  });
  expect(readConversationDraft("scope", "token")).toBe("");
  expect(() => writeConversationDraft("scope", "Keep this note")).toThrow(
    "Unavailable"
  );
});

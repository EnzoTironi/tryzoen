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
  const token = writeConversationDraft("account-a/workspace-a", {
    text: "Private reading note",
    files: [],
  });
  expect(token).not.toContain("Private");
  expect(readConversationDraft("account-a/workspace-a", token)).toEqual({
    text: "Private reading note",
    files: [],
  });
  expect(readConversationDraft("account-b/workspace-a", token)).toBeUndefined();
  expect(readConversationDraft("account-a/workspace-b", token)).toBeUndefined();
  const replacement = writeConversationDraft("account-a/workspace-a", {
    text: "New note",
    files: [],
  });
  forgetConversationDraft("account-a/workspace-a", token);
  expect(readConversationDraft("account-a/workspace-a", replacement)).toEqual({
    text: "New note",
    files: [],
  });
  expect(readConversationDraft("account-a/workspace-a", token)).toBeUndefined();
  forgetConversationDraft("account-a/workspace-a", replacement);
  expect(
    readConversationDraft("account-a/workspace-a", replacement)
  ).toBeUndefined();
});

it("does not accept arbitrary URL text and reports failure to store a new draft", () => {
  expect(readConversationDraft("scope", "Private text in URL")).toBeUndefined();
  vi.stubGlobal("sessionStorage", {
    getItem: () => {
      throw new Error("Unavailable");
    },
    setItem: () => {
      throw new Error("Unavailable");
    },
  });
  expect(readConversationDraft("scope", "token")).toBeUndefined();
  expect(() =>
    writeConversationDraft("scope", { text: "Keep this note", files: [] })
  ).toThrow("Unavailable");
});

it("preserves attachments during a scoped handoff without exposing them in the URL", () => {
  const draft = {
    text: "Read",
    files: [
      {
        type: "file" as const,
        filename: "note.txt",
        mediaType: "text/plain",
        url: "data:text/plain;base64,YQ==",
      },
    ],
  };
  const token = writeConversationDraft("account/workspace", draft);
  expect(token).toMatch(/^[\da-f-]{36}$/u);
  expect(readConversationDraft("account/workspace", token)).toEqual(draft);
  expect(readConversationDraft("other/workspace", token)).toBeUndefined();
});

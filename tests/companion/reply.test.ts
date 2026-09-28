import { expect, it } from "vitest";
import {
  messageText,
  replyMessage,
  readReplyMessage,
} from "../../packages/companion-ui/src/session/reply";

it("keeps ordinary drafts intact and persists the identity of a quoted message", () => {
  expect(replyMessage("Keep my draft")).toBe("Keep my draft");
  expect(
    replyMessage("Let's discuss this", {
      id: "message-123",
      role: "assistant",
      text: "One idea\n\nA second paragraph",
    })
  ).toBe(
    "Reply to assistant message message-123:\n> One idea\n> \n> A second paragraph\n\nLet's discuss this"
  );
});

it("renders persisted quotations after reload without treating ordinary text as metadata", () => {
  const encoded = replyMessage("My response", {
    id: "turn_0:assistant",
    role: "assistant",
    text: "First line\n\nLast line",
  });
  expect(readReplyMessage(encoded)).toEqual({
    id: "turn_0:assistant",
    role: "assistant",
    quote: "First line\n\nLast line",
    text: "My response",
  });
  expect(
    readReplyMessage("Reply to an idea\n> Ordinary quotation")
  ).toBeUndefined();
  expect(
    readReplyMessage("Reply to system message 1:\n> Untrusted\n\nText")
  ).toBeUndefined();
});

it("bounds long quoted context without trimming the user's response", () => {
  const result = replyMessage("My whole answer", {
    id: "1",
    role: "user",
    text: "a".repeat(6000),
  });
  expect(result).toContain(`${"a".repeat(4000)}…`);
  expect(result).not.toContain("a".repeat(4001));
  expect(result.endsWith("My whole answer")).toBe(true);
});

it("stages a removable Feed quotation without inventing a user question", () => {
  const quote = {
    id: "feed:9c69b04e-089f-4a87-b171-2ed558c1e01f",
    role: "assistant" as const,
    text: "A little reading, every evening",
  };
  const staged = readReplyMessage(replyMessage("", quote));
  expect(staged).toEqual({
    id: quote.id,
    role: "assistant",
    quote: quote.text,
    text: "",
  });
  expect(
    readReplyMessage(replyMessage("What if I only have five minutes?", quote))
      ?.text
  ).toBe("What if I only have five minutes?");
  expect(replyMessage("Keep my question", undefined)).toBe("Keep my question");
});

it("copies visible message text without tool payloads or authorization values", () => {
  expect(
    messageText({
      id: "1",
      role: "assistant",
      parts: [
        { type: "text", text: "Here is the plan." },
        {
          type: "file",
          filename: "plan.md",
          mediaType: "text/markdown",
          url: "https://example.com/plan",
        },
        { type: "text", text: "Take one step." },
      ],
    })
  ).toBe("Here is the plan.\n\nTake one step.");
});

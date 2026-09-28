import {
  attachmentLimits,
  inlineAttachmentBytes,
  requireAttachmentSizes,
} from "../attachments/limits";
import { describe, expect, it } from "vitest";
import { chatTitle, messageContent, conversationDraftSchema } from "./input";

describe("chat message input", () => {
  it("uses trimmed text directly when there are no attachments", () => {
    expect(messageContent({ files: [], text: "  Hello  " })).toBe("Hello");
  });

  it("builds multimodal content without an empty text part", () => {
    expect(
      messageContent({
        files: [
          {
            filename: "receipt.png",
            mediaType: "image/png",
            type: "file",
            url: "data:image/png;base64,YQ==",
          },
        ],
        text: "  ",
      })
    ).toEqual([
      {
        data: "data:image/png;base64,YQ==",
        filename: "receipt.png",
        mediaType: "image/png",
        type: "file",
      },
    ]);
  });

  it("derives a title from text before falling back to a filename", () => {
    expect(chatTitle({ files: [], text: "  Plan a trip  " })).toBe(
      "Plan a trip"
    );
    expect(
      chatTitle({
        files: [
          {
            filename: "receipt.png",
            mediaType: "image/png",
            type: "file",
            url: "data:image/png;base64,YQ==",
          },
        ],
        text: "",
      })
    ).toBe("receipt.png");
  });
});

const attachment = {
  type: "file" as const,
  filename: "note.txt",
  mediaType: "text/plain",
  url: "data:text/plain;base64,YQ==",
};

it.each([
  "https://example.com/file.txt",
  "javascript:alert(1)",
  "data:text/html;base64,YQ==",
  "data:text/plain;base64,YQ=",
  "data:text/plain;base64,????",
])("rejects invalid or external draft attachment URLs: %s", (url) => {
  expect(
    conversationDraftSchema.safeParse({
      text: "",
      files: [{ ...attachment, url }],
    }).success
  ).toBe(false);
});

it("counts decoded bytes, including padding, and enforces the combined limit", () => {
  expect(inlineAttachmentBytes("data:text/plain;base64,YQ==")).toBe(1);
  expect(inlineAttachmentBytes("data:text/plain;base64,YWI=")).toBe(2);
  expect(inlineAttachmentBytes("data:text/plain;base64,YWJj")).toBe(3);
  const boundary = {
    ...attachment,
    url: `data:text/plain;base64,${"AAAA".repeat(attachmentLimits.bytes / 3)}`,
  };
  expect(
    conversationDraftSchema.safeParse({ text: "", files: [boundary] }).success
  ).toBe(true);
  expect(
    conversationDraftSchema.safeParse({
      text: "",
      files: [boundary, attachment],
    }).success
  ).toBe(false);
  expect(() => {
    requireAttachmentSizes([attachmentLimits.bytes, 1]);
  }).toThrow("3 MiB");
  expect(() => {
    requireAttachmentSizes([NaN]);
  }).toThrow(/3 MiB|Too big/u);
  expect(() => {
    requireAttachmentSizes([-1]);
  }).toThrow(/3 MiB|Too big/u);
});

it("refuses to send over-count and oversized drafts", () => {
  expect(() =>
    messageContent({
      text: "",
      files: Array.from({ length: 5 }, () => attachment),
    })
  ).toThrow(/3 MiB|Too big/u);
  expect(() => messageContent({ text: "x".repeat(10001), files: [] })).toThrow(
    /3 MiB|Too big/u
  );
});

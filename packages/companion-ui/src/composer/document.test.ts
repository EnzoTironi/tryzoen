import { expect, it } from "vitest";
import { documentMarkdown } from "../editor/markdown";
import {
  composerMarkdown,
  composerReferenceAt,
  composerReferenceContent,
  replaceComposerRange,
} from "./document";
it("finds a reference inside formatted prose using editor positions, not Markdown offsets", () => {
  const content = documentMarkdown.parse("**Leia @ref amanhã**");
  const query = composerReferenceAt(content, 10);
  expect(query).toEqual({ trigger: "@", query: "ref", start: 6, end: 10 });
  const next = replaceComposerRange(
    content,
    6,
    10,
    composerReferenceContent({
      id: "file-1",
      kind: "file",
      token: "@knowledge/plan.md",
      title: "plan.md",
      detail: "Plano",
    })
  );
  const markdown = composerMarkdown(next);
  expect(markdown).toContain("@knowledge/plan.md");
  expect(markdown).toContain("amanhã");
  expect(markdown).not.toContain("zoen-reference:");
  expect(markdown).toContain("**Leia");
});
it("preserves rich formatting through send and reload", () => {
  const markdown =
    "**Bold** and *italic*\n\n- One\n- Two\n\n> A quote\n\n`code`";
  const serialized = composerMarkdown(documentMarkdown.parse(markdown));
  expect(composerMarkdown(documentMarkdown.parse(serialized))).toBe(serialized);
  expect(serialized).toContain("**Bold**");
  expect(serialized).toContain("> A quote");
});
it("does not reopen suggestions inside a chosen reference and safely handles malformed pasted tags", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: composerReferenceContent({
          id: "a",
          kind: "person",
          token: "@ana",
          title: "Ana",
          detail: "",
        }),
      },
    ],
  };
  expect(composerReferenceAt(doc, 2)).toBeNull();
  expect(
    composerMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Visible",
              marks: [
                {
                  type: "link",
                  attrs: { href: "zoen-reference:/person/%broken" },
                },
              ],
            },
          ],
        },
      ],
    })
  ).toBe("Visible");
});

it("preserves spaces on both sides of an inline reference", () => {
  const content = documentMarkdown.parse("Leia @ref amanhã");
  const next = replaceComposerRange(
    content,
    6,
    10,
    composerReferenceContent({
      id: "f",
      kind: "file",
      token: "@knowledge/plan.md",
      title: "plan.md",
      detail: "",
    })
  );
  expect(composerMarkdown(next)).toBe("Leia @knowledge/plan.md  amanhã");
});

it("keeps editor offsets aligned after a soft line break", () => {
  const content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Plano", marks: [{ type: "bold" }] },
          { type: "hardBreak" },
          { type: "text", text: "Leia @ref" },
        ],
      },
    ],
  };
  expect(composerReferenceAt(content, 16)).toEqual({
    trigger: "@",
    query: "ref",
    start: 12,
    end: 16,
  });
  const next = replaceComposerRange(
    content,
    12,
    16,
    composerReferenceContent({
      id: "f",
      kind: "file",
      token: "@knowledge/plan.md",
      title: "plan.md",
      detail: "",
    })
  );
  expect(composerMarkdown(next)).toContain("Leia @knowledge/plan.md");
});

import { expect, test } from "vitest";
import { corpusPages, corpusDigest } from "./schema";
import { randomUUID } from "node:crypto";

test("exact source chunks preserve Unicode, whitespace, offsets and deterministic identity", () => {
  const namespace = randomUUID();
  const entry = {
    entryId: randomUUID(),
    title: "Source",
    kind: "authored" as const,
    attribution: "Own text",
    rights: "original" as const,
    source: null,
  };
  const text = ` \n${"x".repeat(7997)}😀${"漢".repeat(9000)}\n `;
  const pages = corpusPages(namespace, entry, text);
  expect(pages.map((page) => page.body).join("")).toBe(text);
  expect(pages).toEqual(corpusPages(namespace, entry, text));
  for (const page of pages) {
    expect(page.body).toBe(text.slice(page.start, page.end));
    expect(page.digest).toBe(corpusDigest(page.body));
    expect(page.body.length).toBeLessThanOrEqual(8000);
    expect(page.body).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  }
  expect(
    corpusPages(namespace, { ...entry, kind: "guidance" }, text)[0]?.path
  ).not.toBe(pages[0]?.path);
});

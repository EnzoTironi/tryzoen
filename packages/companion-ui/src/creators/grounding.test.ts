import { expect, test } from "vitest";
import { creatorCitationSchema } from "./grounding";
test("citation offsets preserve exact whitespace and reject reversed or truncated ranges", () => {
  const citation = {
    id: "S1",
    title: "Source",
    attribution: "Original",
    excerpt: "  🦋\n",
    excerptDigest: "a".repeat(64),
    pageDigest: "b".repeat(64),
    entryId: "00000000-0000-4000-8000-000000000001",
    start: 7,
    end: 12,
    offsetUnit: "utf16",
  };
  expect(creatorCitationSchema.parse(citation).excerpt).toBe(citation.excerpt);
  expect(creatorCitationSchema.safeParse({ ...citation, end: 7 }).success).toBe(
    false
  );
  expect(
    creatorCitationSchema.safeParse({ ...citation, end: 11 }).success
  ).toBe(false);
});

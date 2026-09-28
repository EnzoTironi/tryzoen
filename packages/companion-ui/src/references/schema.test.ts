import { expect, it } from "vitest";
import { referenceAt, insertReference } from "./schema";

it("finds the token at the caret without treating mail addresses, links or prices as references", () => {
  expect(referenceAt("Ask @ana about it", 8)).toEqual({
    trigger: "@",
    query: "ana",
    start: 4,
    end: 8,
  });
  expect(referenceAt("Use $calendar", 13)?.trigger).toBe("$");
  expect(referenceAt("Use /morning", 12)?.trigger).toBe("/");
  expect(referenceAt("Pay $100", 8)).toBeNull();
  expect(referenceAt("ana@example.com", 15)).toBeNull();
  expect(referenceAt("https://example.com/file", 24)).toBeNull();
});

it("inserts a reference in the middle without deleting the rest of the message", () => {
  expect(
    insertReference("Read @pla tomorrow", 5, 9, "@knowledge/plan.md")
  ).toEqual({ text: "Read @knowledge/plan.md  tomorrow", caret: 24 });
});

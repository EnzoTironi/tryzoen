import { expect, it } from "vitest";
import {
  personalNoteText,
  readPersonalNote,
  replacePersonalNoteText,
} from "./document";

it("keeps existing indices and never recycles removed indices during human edits", () => {
  const before =
    "<!-- eve-memory-file-v1 lastAllocatedIndex=7 -->\n2: Likes coffee\n7: Lives in London\n";
  const after = replacePersonalNoteText(
    before,
    "Lives in Paris\nLikes coffee\nLikes coffee"
  );
  expect(readPersonalNote(after)).toEqual({
    lastIndex: 8,
    entries: [
      { index: 2, text: "Likes coffee" },
      { index: 8, text: "Lives in Paris" },
    ],
  });
  expect(personalNoteText(after)).toBe("Likes coffee\nLives in Paris");
  const empty = replacePersonalNoteText(after, "");
  expect(readPersonalNote(empty)).toEqual({ lastIndex: 8, entries: [] });
  expect(
    readPersonalNote(replacePersonalNoteText(empty, "A new fact")).entries[0]
      ?.index
  ).toBe(9);
});

it("rejects unknown formats and bounds UTF-8 entries and total recall", () => {
  const empty = "<!-- eve-memory-file-v1 lastAllocatedIndex=-1 -->\n";
  expect(() => readPersonalNote("arbitrary markdown")).toThrow(/format/);
  expect(() =>
    readPersonalNote(
      "<!-- eve-memory-file-v1 lastAllocatedIndex=1 -->\n1: One\n1: Two\n"
    )
  ).toThrow(/Invalid memory entry/);
  expect(() => replacePersonalNoteText(empty, "é".repeat(1025))).toThrow(
    /2,048/
  );
  expect(() =>
    replacePersonalNoteText(
      empty,
      ["a".repeat(1900), "b".repeat(1900)].join("\n")
    )
  ).toThrow(/too long/);
});

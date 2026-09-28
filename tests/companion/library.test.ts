import { describe, expect, it } from "vitest";
import { fileTreeRows } from "../../packages/companion-ui/src/library/paths";

const paths = [
  "agent/SOUL.md",
  "agent/memory/daily.md",
  "knowledge/plan.md",
  "README.md",
];

describe("library file hierarchy", () => {
  it("collapses descendants and keeps files directly after their expanded parent", () => {
    expect(
      fileTreeRows(paths, new Set(), "", false).map((row) => row.id)
    ).toEqual(["agent/", "knowledge/", "README.md"]);
    expect(
      fileTreeRows(paths, new Set(["agent/", "agent/memory/"]), "", false).map(
        (row) => row.id
      )
    ).toEqual([
      "agent/",
      "agent/memory/",
      "agent/memory/daily.md",
      "agent/SOUL.md",
      "knowledge/",
      "README.md",
    ]);
  });
  it("reverses siblings without detaching children or duplicating folders", () => {
    expect(
      fileTreeRows(paths, new Set(["agent/", "knowledge/"]), "", true).map(
        (row) => row.id
      )
    ).toEqual([
      "knowledge/",
      "knowledge/plan.md",
      "agent/",
      "agent/memory/",
      "agent/SOUL.md",
      "README.md",
    ]);
  });
  it("reveals matching paths through collapsed ancestors and normalizes search whitespace", () => {
    const rows = fileTreeRows(paths, new Set(), "  DAILY  ", false);
    expect(rows.map((row) => [row.id, row.depth])).toEqual([
      ["agent/", 0],
      ["agent/memory/", 1],
      ["agent/memory/daily.md", 2],
    ]);
    expect(fileTreeRows(paths, new Set(), "missing", false)).toEqual([]);
  });
});

import { expect, test } from "vitest";
import { SemanticSnapshotSchema } from "./snapshot";

const snapshot = (cell: unknown, type = "text") => ({
  model: "source: records is postgresql.table('records')",
  query: "records",
  arguments: {},
  tables: [
    {
      name: "records",
      columns: [{ name: "value", type }],
      rows: [[cell]],
    },
  ],
});

test.each(["text", "numeric"])(
  "rejects a column definition object as a %s row cell",
  (type) => {
    expect(
      SemanticSnapshotSchema.safeParse(
        snapshot({ name: "injected", type: "text" }, type)
      ).success
    ).toBe(false);
  }
);

test.each([
  { cell: "text" },
  { cell: "" },
  { cell: 42 },
  { cell: -0.25 },
  { cell: true },
  { cell: false },
  { cell: null },
])("preserves valid scalar or null cell $cell", ({ cell }) => {
  const input = snapshot(cell);
  expect(SemanticSnapshotSchema.parse(input)).toEqual(input);
});

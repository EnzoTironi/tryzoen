import { expect, test } from "vitest";
import { WorkspacePathSchema, sourceBindingPathSchema } from "./files-schema";

test.each([
  "knowledge/sources/studio.json",
  "knowledge/sources/a_b-2.json",
  `knowledge/sources/${"a".repeat(64)}.json`,
])("admits canonical source files: %s", (path) => {
  expect(sourceBindingPathSchema.parse(path)).toBe(path);
  expect(WorkspacePathSchema.parse(path)).toBe(path);
});
test.each([
  "knowledge/sources/studio.md",
  "knowledge/sources/Studio.json",
  "knowledge/sources/.hidden.json",
  "knowledge/sources/a/b.json",
  "knowledge/sources/a..b.json",
  "knowledge/sources/../a.json",
  "knowledge/sources//a.json",
  "knowledge/sources/a.json\n",
  `knowledge/sources/${"a".repeat(65)}.json`,
])("rejects noncanonical source namespace paths: %s", (path) => {
  expect(sourceBindingPathSchema.safeParse(path).success).toBe(false);
  expect(WorkspacePathSchema.safeParse(path).success).toBe(false);
});
test.each([
  "knowledge/plan.md",
  "knowledge/models/studio.malloy",
  "knowledge/queries/studio.json",
  "knowledge/data/studio.csv",
  "knowledge/routing/index.json",
  "ontology/workspace.json",
  "agent/AGENTS.md",
  "skills/inbox.md",
  "proposals/tools/inbox.json",
])("preserves existing file contracts: %s", (path) => {
  expect(WorkspacePathSchema.parse(path)).toBe(path);
});

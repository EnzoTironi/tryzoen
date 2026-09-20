import { expect, test } from "vitest";
import { parseSkillDocument } from "./skill-document";

test("parses a title without frontmatter and a strict requires list", () => {
  expect(
    parseSkillDocument("# Launch checklist\n\nCheck the revision.")
  ).toEqual({
    requires: [],
    body: "# Launch checklist\n\nCheck the revision.",
    title: "Launch checklist",
  });
  expect(
    parseSkillDocument(
      "---\nrequires: [workspace_files_list, workspace-save]\n---\n# Inbox\n\nTriage mail."
    )
  ).toEqual({
    requires: ["workspace_files_list", "workspace-save"],
    body: "# Inbox\n\nTriage mail.",
    title: "Inbox",
  });
});

test("rejects invalid skill documents", () => {
  expect(parseSkillDocument("")).toBeNull();
  expect(parseSkillDocument("---\nrequires: []\n---\n")).toBeNull();
  expect(
    parseSkillDocument("---\ndescription: leaked\n---\n# Title\n")
  ).toBeNull();
  expect(
    parseSkillDocument(
      "---\nrequires: [workspace_files_list, workspace_files_list]\n---\n# Title\n"
    )
  ).toBeNull();
  expect(
    parseSkillDocument(
      '---\nrequires: ["workspace_files_list"]\n---\n# Title\n'
    )
  ).toBeNull();
});

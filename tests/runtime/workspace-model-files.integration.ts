import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import { WorkspacePathSchema } from "@zoen/companion-ui/workspace-files";
import { readWorkspaceGit } from "../../server/workspaces/git";

test("native analytic source stays an authorized versioned file through edits, conflicts and export", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest, personal, repository } = fixture;
  const path = "knowledge/models/projects.malloy";
  const content =
    "// Synthetic authored source; not a query execution\nsource: projects is postgres.table('projects') extend {\n  primary_key: id\n  measure: budget_total is budget.sum()\n}\n";
  const input = {
    operationId: randomUUID(),
    expectedRevision: null,
    path,
    content,
  };
  const published = await repository.write(actor, input);
  expect(await repository.write(actor, input)).toEqual(published);
  expect((await repository.read(guest, path)).content).toBe(content);
  expect(
    (await repository.selection(guest, [path])).documents[0]?.content
  ).toBe(content);
  expect((await repository.search(guest, "budget_total")).matches).toHaveLength(
    1
  );
  expect((await repository.read(personal)).files).toEqual([]);
  const next = await repository.write(guest, {
    ...input,
    operationId: randomUUID(),
    expectedRevision: published.revision,
    content: content.replace("budget_total", "planned_budget"),
  });
  await expect(
    repository.write(actor, { ...input, operationId: randomUUID() })
  ).rejects.toMatchObject({ reason: "conflict" });
  expect((await repository.read(actor, path, published.revision)).content).toBe(
    content
  );
  expect(
    (await repository.history(actor, path)).map((item) => item.revision)
  ).toEqual([next.revision, published.revision]);
  const exported = await repository.export(actor);
  if (!exported) throw new Error("Missing synthetic source export");
  expect(
    (await readWorkspaceGit(exported.bundle, next.revision, path)).content
  ).toBe(content.replace("budget_total", "planned_budget"));
  for (const invalid of [
    "agent/rules.malloy",
    "knowledge/projects.malloy",
    "knowledge/models/../secret.malloy",
    "knowledge/models/query.sql",
    "knowledge/models/.hidden.malloy",
    "knowledge/models//other.malloy",
  ])
    expect(WorkspacePathSchema.safeParse(invalid).success).toBe(false);
});

import { randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { callNativeTool } from "../helpers/native-tools";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";

test("native listing and literal search use historical paths and bounded text without current fallback", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal, repository } = workspace;
  const path = "knowledge/report.md";
  const definition = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path,
    content: `needle[old] ${"x".repeat(2000)}\n`.repeat(10),
  });
  const old = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: definition.revision,
    path: "agent/USER.md",
    content: "Private profile, never a search result.",
  });
  const timestamps = await query<{ asOf: string }>(
    sql`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "asOf"
      FROM workspace_revision WHERE workspace_id = ${actor.workspaceId} AND revision = ${old.revision}`
  );
  const asOf = timestamps[0]?.asOf;
  if (!asOf) throw new Error("Missing recorded publication time");
  const current = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: old.revision,
    changes: [
      { path, content: null },
      { path: "knowledge/moved.md", content: "needle[new] is current." },
    ],
  });
  const execution = workspaceExecutionFor(guest);
  for (const view of [{ asOf }, { revision: old.revision }]) {
    expect(
      await callNativeTool(execution, "workspace_files_list", view)
    ).toMatchObject({
      revision: old.revision,
      files: ["agent/USER.md", path],
    });
    const found = await repository.search(guest, "needle[old]", view);
    expect(found.revision).toBe(old.revision);
    expect(found.matches).toHaveLength(3);
    expect(found.matches.every((match) => match.length <= 800)).toBe(true);
    expect(found.matches.every((match) => match.startsWith(`${path}:`))).toBe(
      true
    );
    expect(
      await callNativeTool(execution, "workspace_files_search", {
        ...view,
        query: "needle[old]",
      })
    ).toMatchObject(found);
  }
  expect(
    await callNativeTool(execution, "workspace_files_list", {})
  ).toMatchObject({
    revision: current.revision,
    files: ["agent/USER.md", "knowledge/moved.md"],
  });
  expect(
    await callNativeTool(execution, "workspace_files_search", {
      query: "needle[old]",
    })
  ).toMatchObject({ revision: current.revision, matches: [] });
  expect(
    await callNativeTool(execution, "workspace_files_search", {
      asOf,
      query: "Private profile",
    })
  ).toMatchObject({ revision: old.revision, matches: [] });
  const before = { asOf: "2000-01-01T00:00:00Z" };
  expect(
    await callNativeTool(execution, "workspace_files_list", before)
  ).toMatchObject({
    revision: null,
    files: [],
  });
  expect(
    await callNativeTool(execution, "workspace_files_search", {
      ...before,
      query: "needle",
    })
  ).toMatchObject({ revision: null, matches: [] });
  const other = workspaceExecutionFor(personal);
  expect(
    await callNativeTool(other, "workspace_files_list", { asOf })
  ).toMatchObject({
    revision: null,
    files: [],
  });
  await expect(
    callNativeTool(other, "workspace_files_search", {
      revision: old.revision,
      query: "needle",
    })
  ).rejects.toMatchObject({ reason: "not_found" });
  await expect(
    callNativeTool(execution, "workspace_files_list", {
      asOf,
      revision: old.revision,
    })
  ).rejects.toThrow(/Choose a recorded revision/);
  await expect(
    callNativeTool(execution, "workspace_files_search", {
      asOf: "2026-09-30T10:30:00",
      query: "needle",
    })
  ).rejects.toMatchObject({ name: "ZodError" });
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
  );
  await expect(
    callNativeTool(execution, "workspace_files_list", { asOf })
  ).rejects.toMatchObject({
    _tag: "WorkspaceAccessDenied",
  });
  await expect(
    callNativeTool(execution, "workspace_files_search", {
      asOf,
      query: "needle",
    })
  ).rejects.toMatchObject({ _tag: "WorkspaceAccessDenied" });
});

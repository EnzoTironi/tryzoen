import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";

test("contribution receipts validate hashes and event IDs and are erased with the personal workspace", async () => {
  const database = new PGlite();
  try {
    await database.exec("CREATE TABLE workspaces (id text PRIMARY KEY)");
    await database.exec(
      await readFile(
        new URL(
          "../migrations/0107_matrix-contribution-receipts.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    await database.exec(
      "INSERT INTO workspaces (id) VALUES ('personal-owner')"
    );
    const insert = (hash: string, eventId: string | null) =>
      database.query(
        `INSERT INTO matrix_contribution_receipts (workspace_id, operation_id, owner_user_id, request_hash, event_id)
        VALUES ('personal-owner', '11111111-1111-4111-8111-111111111111', 'owner', $1, $2)`,
        [hash, eventId]
      );
    await expect(insert("not-a-hash", null)).rejects.toThrow(
      "matrix_contribution_receipts_hash_check"
    );
    await expect(insert("a".repeat(64), "")).rejects.toThrow(
      "matrix_contribution_receipts_event_check"
    );
    await expect(insert("a".repeat(64), "x".repeat(257))).rejects.toThrow(
      "matrix_contribution_receipts_event_check"
    );
    await insert("a".repeat(64), null);
    await expect(insert("a".repeat(64), "$approved")).rejects.toThrow(
      "matrix_contribution_receipts_workspace_id_operation_id_pk"
    );
    await database.exec("DELETE FROM workspaces WHERE id = 'personal-owner'");
    expect(
      (await database.query("SELECT 1 FROM matrix_contribution_receipts")).rows
    ).toEqual([]);
  } finally {
    await database.close();
  }
});

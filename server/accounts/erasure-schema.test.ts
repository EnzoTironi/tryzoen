import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

const database = new PGlite();
const bindingId = randomUUID();
const requestId = randomUUID();
const matrixId = "@deleted:synthetic.invalid";
const owner = "better-auth:deleted";

beforeAll(async () => {
  await database.exec(`
    CREATE TABLE workspace_group_bindings(id uuid PRIMARY KEY);
    CREATE TABLE matrix_identities(user_id text PRIMARY KEY, matrix_id text UNIQUE);
    CREATE TABLE matrix_room_members(binding_id uuid REFERENCES workspace_group_bindings(id) ON DELETE CASCADE,
      user_id text REFERENCES matrix_identities(user_id) ON DELETE CASCADE, PRIMARY KEY(binding_id,user_id));
    CREATE TABLE account_deletion_requests(id uuid PRIMARY KEY);
    CREATE TABLE account_deletion_ledger(id uuid PRIMARY KEY,request_id uuid NOT NULL REFERENCES account_deletion_requests(id) ON DELETE CASCADE,
      surface text NOT NULL,status text NOT NULL,UNIQUE(request_id,surface));
  `);
  await database.exec(
    await readFile(
      new URL("../../db/migrations/0101_matrix-erasure.sql", import.meta.url),
      "utf8"
    )
  );
}, 20_000);
beforeEach(async () => {
  await database.exec(
    "TRUNCATE workspace_group_bindings, matrix_identities, matrix_room_members, matrix_erasure_departures, account_deletion_requests, account_deletion_ledger CASCADE"
  );
  await database.query("INSERT INTO workspace_group_bindings VALUES ($1)", [
    bindingId,
  ]);
  await database.query("INSERT INTO account_deletion_requests VALUES ($1)", [
    requestId,
  ]);
});
afterAll(() => database.close());

async function receipt(id = matrixId) {
  await database.query(
    "INSERT INTO matrix_erasure_departures(binding_id,matrix_id,owner_user_id) VALUES ($1,$2,$3)",
    [bindingId, id, owner]
  );
}

it("keeps an exact native departure after the identity and local membership cascade", async () => {
  await database.query("INSERT INTO matrix_identities VALUES ($1,$2)", [
    owner,
    matrixId,
  ]);
  await database.query("INSERT INTO matrix_room_members VALUES ($1,$2)", [
    bindingId,
    owner,
  ]);
  await receipt();
  await database.query("DELETE FROM matrix_identities WHERE user_id=$1", [
    owner,
  ]);
  expect(
    (await database.query("SELECT * FROM matrix_room_members")).rows
  ).toEqual([]);
  expect(
    (
      await database.query(
        "SELECT binding_id,matrix_id,owner_user_id FROM matrix_erasure_departures"
      )
    ).rows
  ).toEqual([
    { binding_id: bindingId, matrix_id: matrixId, owner_user_id: owner },
  ]);
});

it("keeps independently captured native identities in the same room", async () => {
  await receipt();
  await receipt("@restored:synthetic.invalid");
  await database.query(
    "DELETE FROM matrix_erasure_departures WHERE binding_id=$1 AND matrix_id=$2",
    [bindingId, matrixId]
  );
  expect(
    (await database.query("SELECT matrix_id FROM matrix_erasure_departures"))
      .rows
  ).toEqual([{ matrix_id: "@restored:synthetic.invalid" }]);
});

it("rejects duplicate room and native-identity receipts", async () => {
  await receipt();
  await expect(receipt()).rejects.toMatchObject({ code: "23505" });
});

it("requires an existing binding while retaining no account or identity foreign key", async () => {
  await expect(
    database.query(
      "INSERT INTO matrix_erasure_departures(binding_id,matrix_id,owner_user_id) VALUES ($1,$2,$3)",
      [randomUUID(), matrixId, owner]
    )
  ).rejects.toMatchObject({ code: "23503" });
  await receipt();
  const keys = await database.query<{ target: string }>(
    "SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid='matrix_erasure_departures'::regclass AND contype='f'"
  );
  expect(keys.rows).toEqual([{ target: "workspace_group_bindings" }]);
});

it("removes room receipts only when their owning binding is removed", async () => {
  await receipt();
  await database.query("DELETE FROM workspace_group_bindings WHERE id=$1", [
    bindingId,
  ]);
  expect(
    (await database.query("SELECT * FROM matrix_erasure_departures")).rows
  ).toEqual([]);
});

it("stores deactivation handles even when the account has no room", async () => {
  await database.query(
    "INSERT INTO account_deletion_ledger VALUES ($1,$2,'matrix','pending_external',$3)",
    [randomUUID(), requestId, [matrixId]]
  );
  expect(
    (await database.query("SELECT matrix_ids FROM account_deletion_ledger"))
      .rows
  ).toEqual([{ matrix_ids: [matrixId] }]);
  expect(
    (await database.query("SELECT * FROM matrix_erasure_departures")).rows
  ).toEqual([]);
});

it("requires exact native-handle removal before acknowledging Matrix erasure", async () => {
  await database.query(
    "INSERT INTO account_deletion_ledger VALUES ($1,$2,'matrix','pending_external',$3)",
    [randomUUID(), requestId, [matrixId]]
  );
  await expect(
    database.query("UPDATE account_deletion_ledger SET status='erased'")
  ).rejects.toMatchObject({ code: "23514" });
  await database.query(
    "UPDATE account_deletion_ledger SET status='erased',matrix_ids=ARRAY[]::text[]"
  );
  expect(
    (
      await database.query(
        "SELECT status,matrix_ids FROM account_deletion_ledger"
      )
    ).rows
  ).toEqual([{ status: "erased", matrix_ids: [] }]);
});

it("rejects placing native identities on an unrelated erasure surface", async () => {
  await expect(
    database.query(
      "INSERT INTO account_deletion_ledger VALUES ($1,$2,'backups','backup_held',$3)",
      [randomUUID(), requestId, [matrixId]]
    )
  ).rejects.toMatchObject({ code: "23514" });
  await database.query(
    "INSERT INTO account_deletion_ledger(id,request_id,surface,status) VALUES ($1,$2,'backups','backup_held')",
    [randomUUID(), requestId]
  );
  expect(
    (await database.query("SELECT matrix_ids FROM account_deletion_ledger"))
      .rows
  ).toEqual([{ matrix_ids: [] }]);
});

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import type { query } from "@db/queries";
import {
  captureMatrixErasureDepartures,
  MatrixErasureDepartureSchema,
} from "./erasure";

const queries = vi.hoisted(() => ({ run: vi.fn<typeof query>() }));
vi.mock("@db/queries", () => ({ query: queries.run }));
const dialect = new PgDialect();
const database = new PGlite();
const bindingId = "10000000-0000-4000-8000-000000000001";
const otherBindingId = "10000000-0000-4000-8000-000000000002";
const owner = "better-auth:deleted";
const matrixId = "@deleted:synthetic.invalid";
const locks: string[] = [];
let locatorReads = 0;
let changeLocator = false;

beforeAll(async () => {
  await database.exec(`
    CREATE TABLE organizations(id text PRIMARY KEY);
    CREATE TABLE workspaces(id text PRIMARY KEY,organization_id text);
    CREATE TABLE organization_memberships(organization_id text,user_id text);
    CREATE TABLE workspace_memberships(workspace_id text,user_id text);
    CREATE TABLE workspace_group_bindings(id uuid PRIMARY KEY,workspace_id text,channel text,conversation_id text,installation_id text,epoch uuid);
    CREATE TABLE matrix_identities(user_id text PRIMARY KEY,matrix_id text UNIQUE);
    CREATE TABLE matrix_room_members(binding_id uuid REFERENCES workspace_group_bindings(id) ON DELETE CASCADE,user_id text REFERENCES matrix_identities(user_id) ON DELETE CASCADE,state text);
    CREATE TABLE account_deletion_requests(id uuid PRIMARY KEY);
    CREATE TABLE account_deletion_ledger(id uuid PRIMARY KEY,request_id uuid REFERENCES account_deletion_requests(id),surface text,status text,UNIQUE(request_id,surface));
  `);
  await database.exec(
    await readFile(
      new URL("../../db/migrations/0101_matrix-erasure.sql", import.meta.url),
      "utf8"
    )
  );
  queries.run.mockImplementation(async (statement) => {
    const { sql, params } = dialect.sqlToQuery(statement);
    if (sql.includes("pg_advisory_xact_lock")) {
      // PGlite cannot prove interconnection locks; security's isolated PostgreSQL suite owns that evidence.
      locks.push(`room:${String(params[0])}`);
      return [];
    }
    if (sql.includes("SELECT id FROM organizations"))
      locks.push(`org:${String(params[0])}`);
    if (sql.includes("SELECT id FROM workspace_group_bindings"))
      locks.push(`binding:${String(params[0])}`);
    if (sql.includes('SELECT matrix_id AS "matrixId"')) locks.push("identity");
    if (sql.includes('SELECT b.id AS "bindingId", b.conversation_id')) {
      locatorReads++;
      if (changeLocator && locatorReads === 2)
        await database.query(
          "UPDATE workspace_group_bindings SET conversation_id='!changed:synthetic.invalid' WHERE id=$1",
          [bindingId]
        );
    }
    return (await database.query<Record<string, unknown>>(sql, params)).rows;
  });
}, 20_000);

beforeEach(async () => {
  locks.length = 0;
  locatorReads = 0;
  changeLocator = false;
  await database.exec(`
    TRUNCATE organizations,workspaces,organization_memberships,workspace_memberships,workspace_group_bindings,matrix_identities,matrix_room_members,matrix_erasure_departures CASCADE;
    INSERT INTO organizations VALUES ('z-org'),('a-org');
    INSERT INTO workspaces VALUES ('workspace','z-org'),('orphan','a-org');
    INSERT INTO organization_memberships VALUES ('z-org','${owner}');
    INSERT INTO workspace_memberships VALUES ('workspace','${owner}');
    INSERT INTO workspace_group_bindings VALUES ('${bindingId}','workspace','matrix','!room:synthetic.invalid','synthetic.invalid','20000000-0000-4000-8000-000000000001');
    INSERT INTO matrix_identities VALUES ('${owner}','${matrixId}');
  `);
  await database.exec("BEGIN");
});
afterEach(() => database.exec("ROLLBACK"));
afterAll(() => database.close());

async function epoch(id = bindingId) {
  const result = await database.query<{ epoch: unknown }>(
    "SELECT epoch FROM workspace_group_bindings WHERE id=$1",
    [id]
  );
  return z.uuid().parse(result.rows[0]?.epoch);
}
async function receipts() {
  const result = await database.query(
    "SELECT binding_id,matrix_id,owner_user_id,native_retry_at FROM matrix_erasure_departures ORDER BY binding_id,matrix_id"
  );
  return z
    .array(
      z.object({
        binding_id: MatrixErasureDepartureSchema.shape.bindingId,
        matrix_id: MatrixErasureDepartureSchema.shape.matrixId,
        owner_user_id: z.string(),
        native_retry_at: z.date(),
      })
    )
    .parse(result.rows);
}

it("captures a possible first join before a local room member exists", async () => {
  const result = await captureMatrixErasureDepartures(owner);
  expect(result).toEqual([
    {
      bindingId,
      matrixId,
      roomId: "!room:synthetic.invalid",
      installationId: "synthetic.invalid",
      workspaceId: "workspace",
      organizationId: "z-org",
    },
  ]);
  expect(await receipts()).toHaveLength(1);
  expect(locks).toEqual([
    "org:z-org",
    `room:${bindingId}`,
    `binding:${bindingId}`,
    "identity",
  ]);
});

it("merges identical live, pending and inherited references without replay conflict or epoch churn", async () => {
  const captured = await captureMatrixErasureDepartures(owner);
  const firstEpoch = await epoch();
  expect(await captureMatrixErasureDepartures(owner, captured)).toEqual(
    captured
  );
  expect(await epoch()).toBe(firstEpoch);
  expect(await receipts()).toHaveLength(1);
});

it("rehydrates a journal capture after the SQL transaction rolled back", async () => {
  const captured = await captureMatrixErasureDepartures(owner);
  await database.exec("ROLLBACK; BEGIN;");
  expect(await receipts()).toHaveLength(0);
  expect(await captureMatrixErasureDepartures(owner, captured)).toEqual(
    captured
  );
  expect(await receipts()).toHaveLength(1);
});

it("preserves exact native receipts after identity and membership cascade", async () => {
  await database.query(
    "INSERT INTO matrix_room_members VALUES ($1,$2,'joined')",
    [bindingId, owner]
  );
  const captured = await captureMatrixErasureDepartures(owner);
  await database.query("DELETE FROM matrix_identities WHERE user_id=$1", [
    owner,
  ]);
  await database.query("DELETE FROM workspace_memberships WHERE user_id=$1", [
    owner,
  ]);
  await database.query(
    "DELETE FROM organization_memberships WHERE user_id=$1",
    [owner]
  );
  expect(await captureMatrixErasureDepartures(owner)).toEqual(captured);
  expect(await receipts()).toHaveLength(1);
});

it("locks the complete sorted organizations before rooms, including an orphan earlier-sorting organization", async () => {
  await database.query(
    "INSERT INTO workspace_group_bindings VALUES ($1,'orphan','matrix','!orphan:synthetic.invalid','synthetic.invalid',$2)",
    [otherBindingId, "20000000-0000-4000-8000-000000000002"]
  );
  await database.query(
    "INSERT INTO matrix_room_members VALUES ($1,$2,'removed')",
    [otherBindingId, owner]
  );
  expect(await captureMatrixErasureDepartures(owner)).toHaveLength(2);
  expect(locks).toEqual([
    "org:a-org",
    "org:z-org",
    `room:${bindingId}`,
    `room:${otherBindingId}`,
    `binding:${bindingId}`,
    `binding:${otherBindingId}`,
    "identity",
  ]);
});

it("rejects a changed native locator before identity capture or departure writes", async () => {
  changeLocator = true;
  await expect(captureMatrixErasureDepartures(owner)).rejects.toThrow(
    "frontier changed"
  );
  expect(locks).not.toContain("identity");
  expect(await receipts()).toHaveLength(0);
  expect(
    (await database.query("SELECT * FROM matrix_identities")).rows
  ).toHaveLength(1);
});

it("rejects journal references that rebind an existing binding to a different native room", async () => {
  const [reference] = await captureMatrixErasureDepartures(owner);
  expect(reference).toBeDefined();
  if (!reference) throw new Error("Missing captured reference");
  await expect(
    captureMatrixErasureDepartures(owner, [
      { ...reference, roomId: "!foreign:synthetic.invalid" },
    ])
  ).rejects.toThrow("locator changed");
});

it("maps the same exact native room to its recreated binding without requiring restored membership", async () => {
  const captured = await captureMatrixErasureDepartures(owner);
  await database.query("DELETE FROM workspace_group_bindings WHERE id=$1", [
    bindingId,
  ]);
  await database.query("DELETE FROM matrix_identities WHERE user_id=$1", [
    owner,
  ]);
  await database.query("DELETE FROM workspace_memberships WHERE user_id=$1", [
    owner,
  ]);
  await database.query(
    "DELETE FROM organization_memberships WHERE user_id=$1",
    [owner]
  );
  await database.query(
    "INSERT INTO workspace_group_bindings VALUES ($1,'workspace','matrix','!room:synthetic.invalid','synthetic.invalid',$2)",
    [otherBindingId, "20000000-0000-4000-8000-000000000002"]
  );
  const result = await captureMatrixErasureDepartures(owner, captured);
  expect(result).toHaveLength(2);
  expect(result).toContainEqual({ ...captured[0], bindingId: otherBindingId });
  expect(await receipts()).toMatchObject([
    { binding_id: otherBindingId, matrix_id: matrixId, owner_user_id: owner },
  ]);
});

it("preserves an unbound exact native reference as cleanup evidence", async () => {
  const captured = await captureMatrixErasureDepartures(owner);
  await database.query("DELETE FROM workspace_group_bindings WHERE id=$1", [
    bindingId,
  ]);
  await database.query("DELETE FROM matrix_identities WHERE user_id=$1", [
    owner,
  ]);
  expect(await captureMatrixErasureDepartures(owner, captured)).toEqual(
    captured
  );
  expect(await receipts()).toHaveLength(0);
});

it("does not steal a native receipt from another account", async () => {
  await database.query(
    "INSERT INTO matrix_erasure_departures(binding_id,matrix_id,owner_user_id) VALUES ($1,$2,'better-auth:other')",
    [bindingId, matrixId]
  );
  await expect(captureMatrixErasureDepartures(owner)).rejects.toThrow(
    "different erasure owner"
  );
  expect(await receipts()).toMatchObject([
    { owner_user_id: "better-auth:other" },
  ]);
});

it("retains future retry times on replay", async () => {
  await captureMatrixErasureDepartures(owner);
  await database.exec(
    "UPDATE matrix_erasure_departures SET native_retry_at=now()+interval '1 day'"
  );
  const previous = (await receipts())[0]?.native_retry_at;
  await captureMatrixErasureDepartures(owner);
  expect((await receipts())[0]?.native_retry_at).toEqual(previous);
});

it("fails explicitly before accepting an oversized pending history", async () => {
  await database.query(
    "INSERT INTO matrix_erasure_departures(binding_id,matrix_id,owner_user_id) SELECT $1,'@prior'||n||':synthetic.invalid',$2 FROM generate_series(1,1025) n",
    [bindingId, owner]
  );
  await expect(captureMatrixErasureDepartures(owner)).rejects.toThrow(
    "bounded capture capacity"
  );
  expect(await receipts()).toHaveLength(1025);
});

it("keeps a no-room identity available for the caller's independent ledger capture", async () => {
  await database.query("DELETE FROM workspace_group_bindings WHERE id=$1", [
    bindingId,
  ]);
  expect(await captureMatrixErasureDepartures(owner)).toEqual([]);
  expect(
    (await database.query("SELECT matrix_id FROM matrix_identities")).rows
  ).toEqual([{ matrix_id: matrixId }]);
});

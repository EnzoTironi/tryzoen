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
import { requireMatrixEgress } from "./authority";
import { WorkspaceAccessDenied } from "../workspaces/access";

const queries = vi.hoisted(() => ({ run: vi.fn<typeof query>() }));
vi.mock("@db/queries", () => ({ query: queries.run }));
const dialect = new PgDialect();
let database: PGlite;
const binding = "10000000-0000-4000-8000-000000000001";
const epoch = "20000000-0000-4000-8000-000000000001";
const agent = "a0000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    CREATE TABLE workspaces(id text PRIMARY KEY, organization_id text);
    CREATE TABLE workspace_memberships(workspace_id text, user_id text, role text, PRIMARY KEY(workspace_id,user_id));
    CREATE TABLE organization_memberships(organization_id text, user_id text, PRIMARY KEY(organization_id,user_id));
    CREATE TABLE matrix_identities(user_id text PRIMARY KEY, matrix_id text);
    CREATE TABLE workspace_group_bindings(id uuid PRIMARY KEY, workspace_id text, epoch uuid, channel text, revoked_at timestamptz);
    CREATE TABLE matrix_room_members(binding_id uuid, user_id text, state text, native_pending boolean, PRIMARY KEY(binding_id,user_id));
    CREATE TABLE matrix_deliveries(event_id text PRIMARY KEY, binding_id uuid, user_id text, epoch uuid, state text);
    CREATE TABLE workspace_agent_members(id uuid PRIMARY KEY, workspace_id text, revoked_at timestamptz);
  `);
  queries.run.mockImplementation(async (statement) => {
    const { sql, params } = dialect.sqlToQuery(statement);
    return (await database.query<Record<string, unknown>>(sql, params)).rows;
  });
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.exec(`
    TRUNCATE workspaces,workspace_memberships,organization_memberships,matrix_identities,
      workspace_group_bindings,matrix_room_members,matrix_deliveries,workspace_agent_members;
    INSERT INTO workspaces VALUES ('workspace','org');
    INSERT INTO workspace_memberships VALUES ('workspace','requester','owner'),('workspace','recipient','member');
    INSERT INTO organization_memberships VALUES ('org','requester'),('org','recipient');
    INSERT INTO matrix_identities VALUES ('requester','@requester:synthetic.invalid'),('recipient','@recipient:synthetic.invalid');
    INSERT INTO workspace_group_bindings VALUES ('${binding}','workspace','${epoch}','matrix',NULL);
    INSERT INTO matrix_room_members VALUES ('${binding}','requester','joined',false),('${binding}','recipient','joined',false);
    INSERT INTO matrix_deliveries VALUES ('$synthetic-event','${binding}','requester','${epoch}','answer_ready');
    BEGIN;
  `);
});

afterEach(async () => {
  await database.exec("ROLLBACK");
});

it("authorizes a currently permitted native room audience using the actual SQL", async () => {
  const actor = await requireMatrixEgress("$synthetic-event");
  expect(actor).toMatchObject({
    userId: "requester",
    workspaceId: "workspace",
    groupEpoch: epoch,
  });
});

it.each(["left", "removed", "joined"])(
  "withholds output while a %s recipient has unresolved native membership",
  async (state) => {
    await database.query(
      "UPDATE matrix_room_members SET state=$1, native_pending=true WHERE user_id='recipient'",
      [state]
    );
    await expect(requireMatrixEgress("$synthetic-event")).rejects.toThrow(
      WorkspaceAccessDenied
    );
  }
);

it.each(["left", "removed"])(
  "allows output after a %s recipient's native departure is confirmed",
  async (state) => {
    await database.query(
      "UPDATE matrix_room_members SET state=$1 WHERE user_id='recipient'",
      [state]
    );
    await expect(
      requireMatrixEgress("$synthetic-event")
    ).resolves.toMatchObject({ userId: "requester" });
  }
);

it.each([
  "DELETE FROM workspace_memberships WHERE user_id='recipient'",
  "DELETE FROM organization_memberships WHERE user_id='recipient'",
])(
  "blocks fresh output after another recipient loses access, before native reconciliation (%s)",
  async (statement) => {
    await database.exec(statement);
    await expect(requireMatrixEgress("$synthetic-event")).rejects.toThrow(
      WorkspaceAccessDenied
    );
  }
);

it("permits an explicitly joined active agent without inheriting a human membership", async () => {
  await database.exec(`INSERT INTO workspace_agent_members VALUES ('${agent}','workspace',NULL);
    INSERT INTO matrix_room_members VALUES ('${binding}','agent:${agent}','joined',false);`);
  await expect(requireMatrixEgress("$synthetic-event")).resolves.toMatchObject({
    userId: "requester",
  });
});

it.each([
  "UPDATE workspace_agent_members SET revoked_at=now()",
  "UPDATE workspace_agent_members SET workspace_id='other-workspace'",
])(
  "withholds output from an agent whose room membership outlives its authority (%s)",
  async (statement) => {
    await database.exec(`INSERT INTO workspace_agent_members VALUES ('${agent}','workspace',NULL);
    INSERT INTO matrix_room_members VALUES ('${binding}','agent:${agent}','joined',false);`);
    await database.exec(statement);
    await expect(requireMatrixEgress("$synthetic-event")).rejects.toThrow(
      WorkspaceAccessDenied
    );
  }
);

it.each([
  "UPDATE workspace_group_bindings SET epoch='20000000-0000-4000-8000-000000000002'",
  "UPDATE workspace_group_bindings SET revoked_at=now()",
  "DELETE FROM workspace_memberships WHERE user_id='requester'",
])(
  "retains requester and captured-epoch revocation checks (%s)",
  async (statement) => {
    await database.exec(statement);
    await expect(requireMatrixEgress("$synthetic-event")).rejects.toThrow(
      WorkspaceAccessDenied
    );
  }
);

import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { query } from "@db/queries";
import {
  lockMatrixAdmission,
  lockMatrixOrganizations,
  matrixDeliveryActor,
} from "./authority";

const mocks = vi.hoisted(() => ({ query: vi.fn<typeof query>() }));
vi.mock("@db/queries", () => ({ query: mocks.query }));
const dialect = new PgDialect();
const binding = "10000000-0000-4000-8000-000000000001";
const epoch = "20000000-0000-4000-8000-000000000001";
const locks: string[] = [];
let locators = [
  { workspaceId: "workspace", organizationId: "org" as string | null },
];
let changeLocator = false;
let locatorReads = 0;
let missingOrganization = false;

beforeEach(() => {
  locks.length = 0;
  locators = [{ workspaceId: "workspace", organizationId: "org" }];
  changeLocator = false;
  locatorReads = 0;
  missingOrganization = false;
  mocks.query.mockReset().mockImplementation(async (statement) => {
    const { sql, params } = dialect.sqlToQuery(statement);
    if (sql.includes('SELECT d.user_id AS "userId"'))
      return [
        {
          userId: "requester",
          workspaceId: "workspace",
          matrixIdentityId: "@requester:synthetic.invalid",
          groupBindingId: binding,
          groupEpoch: epoch,
        },
      ];
    if (
      sql.includes(
        'SELECT w.id AS "workspaceId", w.organization_id AS "organizationId"'
      )
    )
      return ++locatorReads > 1 && changeLocator
        ? [{ workspaceId: "workspace", organizationId: "new-org" }]
        : locators;
    if (sql.includes("SELECT id FROM organizations")) {
      locks.push(`org:${String(params[0])}`);
      return missingOrganization ? [] : [{ id: params[0] }];
    }
    if (sql.includes("pg_advisory_xact_lock")) {
      locks.push(`room:${String(params[0])}`);
      return [];
    }
    if (sql.includes("SELECT m.role, w.organization_id")) {
      locks.push("requester-member");
      return [{ role: "owner", organization_id: "org" }];
    }
    if (sql.includes("SELECT user_id FROM organization_memberships"))
      return [{ user_id: "requester" }];
    if (sql.includes("SELECT b.id FROM workspace_group_bindings")) {
      locks.push("binding-authority");
      return [{ id: binding }];
    }
    throw new Error(`Unexpected SQL in lock-order fixture: ${sql}`);
  });
});

it("takes organization then existing room fences before requester or binding authority", async () => {
  await matrixDeliveryActor("$synthetic-event");
  expect(locks).toEqual([
    `org:org`,
    `room:${binding}`,
    "requester-member",
    "binding-authority",
  ]);
});

it("prelocks every deduplicated organization before every sorted room, regardless of input order", async () => {
  locators = [
    { workspaceId: "workspace", organizationId: "z-org" },
    { workspaceId: "workspace-a", organizationId: "a-org" },
  ];
  await lockMatrixAdmission(
    ["workspace-a", "workspace", "workspace"],
    ["z-room", "a-room", "z-room"]
  );
  expect(locks).toEqual([
    "org:a-org",
    "org:z-org",
    "room:a-room",
    "room:z-room",
  ]);
  expect(locatorReads).toBe(2);
});

it("uses the same sorted organization order for exclusive erasure/revocation fences", async () => {
  await lockMatrixOrganizations(["z-org", "a-org", "z-org"], "update");
  expect(locks).toEqual(["org:a-org", "org:z-org"]);
  for (const [statement] of mocks.query.mock.calls)
    expect(dialect.sqlToQuery(statement).sql).toContain("FOR UPDATE");
});

it("denies a changed organization locator before requester authority", async () => {
  changeLocator = true;
  await expect(matrixDeliveryActor("$synthetic-event")).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
  expect(locks).toEqual(["org:org", `room:${binding}`]);
});

it("denies a missing organization fence before room or requester locks", async () => {
  missingOrganization = true;
  await expect(matrixDeliveryActor("$synthetic-event")).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
  expect(locks).toEqual(["org:org"]);
});

it("preserves personal workspaces without inventing a global organization lock", async () => {
  locators = [{ workspaceId: "workspace", organizationId: null }];
  await lockMatrixAdmission(["workspace"], []);
  expect(locks).toEqual([]);
  expect(locatorReads).toBe(2);
});

it("denies a disappeared requested workspace without acquiring unrelated fences", async () => {
  locators = [];
  await expect(lockMatrixAdmission(["workspace"], [])).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
  expect(locks).toEqual([]);
});

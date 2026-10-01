/** Mocked query ordering only: no PostgreSQL schedule or native removal proof. */
import type { query } from "@db/queries";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { revokeExternalAgentMember } from "./agent-member-revocation";
import { WorkspaceAccessDenied } from "./access";

const mocks = vi.hoisted(() => ({ query: vi.fn<typeof query>() }));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: async <Result>(run: () => Promise<Result>) => run(),
}));
const dialect = new PgDialect();
const provider = vi.fn<typeof fetch>();
const memberId = "a0000000-0000-4000-8000-000000000001";
const bindings = [
  "10000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
];
const actor = {
  userId: "better-auth:synthetic-manager",
  workspaceId: "synthetic-workspace",
  authSessionId: "synthetic-session",
};
const statements: ReturnType<typeof dialect.sqlToQuery>[] = [];
let organizationId: string | null;
let role: string;
let existingMember: boolean;
let failOrganization: boolean;
let failRoom: string | undefined;
let affected: string[];

beforeEach(() => {
  provider.mockReset().mockImplementation(() => {
    throw new Error("Providers are forbidden in this mocked test.");
  });
  vi.stubGlobal("fetch", provider);
  organizationId = "synthetic-organization";
  role = "owner";
  existingMember = true;
  failOrganization = false;
  failRoom = undefined;
  affected = [...bindings];
  statements.length = 0;
  mocks.query.mockReset().mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    compiled.sql = compiled.sql.replace(/\s+/gu, " ").trim();
    statements.push(compiled);
    const { sql, params } = compiled;
    if (
      sql.startsWith(
        'SELECT w.id AS "workspaceId", w.organization_id AS "organizationId"'
      )
    ) {
      const workspaceId = params[0];
      if (typeof workspaceId !== "string")
        throw new Error("Expected exact workspace locator");
      return [{ workspaceId, organizationId }];
    }
    if (sql.includes("FROM organizations")) {
      if (failOrganization)
        throw new Error("Synthetic organization lock failure");
      return organizationId ? [{ id: organizationId }] : [];
    }
    if (sql.startsWith("SELECT m.role, w.organization_id"))
      return [{ role, organization_id: organizationId }];
    if (sql.startsWith("SELECT user_id FROM organization_memberships"))
      return [{ user_id: actor.userId }];
    if (sql.startsWith("SELECT id FROM public.session"))
      return [{ id: actor.authSessionId }];
    if (sql.startsWith("SELECT b.id FROM workspace_group_bindings")) {
      return affected.map((id) => ({ id }));
    }
    if (sql.includes("pg_advisory_xact_lock")) {
      if (params.includes(failRoom))
        throw new Error("Synthetic room lock failure");
      return [];
    }
    if (sql.startsWith("UPDATE workspace_agent_members"))
      return existingMember ? [{ id: memberId }] : [];
    if (sql.startsWith("UPDATE workspace_agent_grants")) return [];
    if (sql.startsWith("WITH retired AS")) return [];
    throw new Error(`Unexpected mocked SQL: ${sql}`);
  });
});

afterEach(() => {
  try {
    if (provider.mock.calls.length > 0)
      throw new Error("Unexpected provider call");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("takes the organization UPDATE fence before any authorization or member lock", async () => {
  await expect(revokeExternalAgentMember(actor, memberId)).resolves.toEqual({
    revoked: true,
  });
  const organization = statements.findIndex(({ sql }) =>
    sql.includes("FROM organizations")
  );
  const authorization = statements.findIndex(({ sql }) =>
    sql.startsWith("SELECT m.role")
  );
  expect(organization).toBeGreaterThanOrEqual(0);
  expect(statements[organization]?.sql).toMatch(/FOR UPDATE(?: OF o)?$/u);
  expect(organization).toBeLessThan(authorization);
});

it("fences the complete affected binding set in order before revocation mutations", async () => {
  affected.reverse();
  await revokeExternalAgentMember(actor, memberId);
  const discovery = statements.findIndex(({ sql }) =>
    sql.startsWith("SELECT b.id FROM workspace_group_bindings")
  );
  const roomFences = statements.filter(({ sql }) =>
    sql.includes("pg_advisory_xact_lock")
  );
  expect(discovery).toBeGreaterThanOrEqual(0);
  expect(statements[discovery]?.sql).toContain("ORDER BY b.id");
  expect(statements[discovery]?.params).toEqual([
    actor.workspaceId,
    "agent:" + memberId,
  ]);
  expect(roomFences.map(({ params }) => params[0])).toEqual(bindings);
  const mutation = statements.findIndex(({ sql }) =>
    sql.startsWith("UPDATE workspace_agent_members")
  );
  expect(mutation).toBeGreaterThan(
    statements.findIndex(({ sql }) => sql.includes("pg_advisory_xact_lock"))
  );
  for (const statement of roomFences)
    expect(statements.indexOf(statement)).toBeLessThan(mutation);
  const grants = statements.find(({ sql }) =>
    sql.startsWith("UPDATE workspace_agent_grants")
  );
  expect(grants?.params).toEqual([memberId]);
  const retirement = statements.find(({ sql }) =>
    sql.startsWith("WITH retired AS")
  );
  expect(retirement?.sql).toContain("native_pending = true");
  expect(retirement?.params).toEqual([actor.workspaceId, "agent:" + memberId]);
});

it("does not authenticate or mutate when the organization fence fails", async () => {
  failOrganization = true;
  await expect(revokeExternalAgentMember(actor, memberId)).rejects.toThrow(
    "Synthetic organization lock failure"
  );
  expect(statements.some(({ sql }) => sql.startsWith("SELECT m.role"))).toBe(
    false
  );
  expect(statements.some(({ sql }) => sql.startsWith("UPDATE"))).toBe(false);
});

it("does not revoke grants or membership if any room fence fails", async () => {
  failRoom = bindings[1];
  await expect(revokeExternalAgentMember(actor, memberId)).rejects.toThrow(
    "Synthetic room lock failure"
  );
  expect(statements.some(({ sql }) => sql.startsWith("UPDATE"))).toBe(false);
  expect(statements.some(({ sql }) => sql.startsWith("WITH retired"))).toBe(
    false
  );
});

it("retains management authorization before touching members or room fences", async () => {
  role = "member";
  await expect(revokeExternalAgentMember(actor, memberId)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(
    statements.some(({ sql }) => sql.includes("pg_advisory_xact_lock"))
  ).toBe(false);
  expect(statements.some(({ sql }) => sql.startsWith("UPDATE"))).toBe(false);
});

it("retains rejection when the requested member is not in this workspace", async () => {
  existingMember = false;
  affected = [];
  await expect(revokeExternalAgentMember(actor, memberId)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(
    statements.some(({ sql }) =>
      sql.startsWith("UPDATE workspace_agent_grants")
    )
  ).toBe(false);
});

it("preserves authorized personal-workspace revocation without company room fences", async () => {
  organizationId = null;
  affected = [];
  const personalActor = { ...actor, ...accessScopeForUser(actor.userId) };
  await expect(
    revokeExternalAgentMember(personalActor, memberId)
  ).resolves.toEqual({ revoked: true });
  expect(
    statements.some(({ sql }) => sql.includes("pg_advisory_xact_lock"))
  ).toBe(false);
});

it("rejects an invalid member identity before issuing SQL", async () => {
  await expect(revokeExternalAgentMember(actor, "not-a-uuid")).rejects.toThrow(
    /Invalid UUID/u
  );
  expect(mocks.query).not.toHaveBeenCalled();
});

import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { resolveWorkspaceBillingSubject } from "./billing";

// Real authorization SQL on isolated PGlite; no billing/provider or concurrent
// PostgreSQL-lock proof. Missing/revoked authority never becomes a Free payer.
const boundary = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  transaction: vi.fn<(run: () => Promise<unknown>) => Promise<unknown>>(),
}));
vi.mock("@db/queries", () => boundary);
const database = new PGlite();
const transactions = new AsyncLocalStorage<{ query: PGlite["query"] }>();
const dialect = new PgDialect();
const rawUserId = "billing-owner";
const userId = `better-auth:${rawUserId}`;
const personal = {
  ...accessScopeForUser(userId),
  authSessionId: "owner-session",
};
const company = { ...personal, workspaceId: "company-studio" };

beforeAll(async () => {
  await database.exec(`CREATE TABLE workspaces(id text PRIMARY KEY, organization_id text);
    CREATE TABLE workspace_memberships(workspace_id text, user_id text, role text);
    CREATE TABLE organization_memberships(organization_id text, user_id text);
    CREATE TABLE public.session(id text PRIMARY KEY, "userId" text, "expiresAt" timestamptz);`);
  boundary.query.mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    return (
      await (transactions.getStore() ?? database).query<
        Record<string, unknown>
      >(compiled.sql, compiled.params)
    ).rows;
  });
  boundary.transaction.mockImplementation(async (run) => {
    if (transactions.getStore()) return await run();
    return await database.transaction(
      async (tx) => await transactions.run(tx, run)
    );
  });
});
afterAll(async () => {
  await database.close();
});
beforeEach(async () => {
  await database.exec(
    "TRUNCATE workspaces, workspace_memberships, organization_memberships, public.session"
  );
  await database.query(
    "INSERT INTO workspaces VALUES ($1, NULL), ($2, 'company')",
    [personal.workspaceId, company.workspaceId]
  );
  await database.query(
    "INSERT INTO workspace_memberships VALUES ($1,$3,'owner'), ($2,$3,'member')",
    [personal.workspaceId, company.workspaceId, userId]
  );
  await database.query(
    "INSERT INTO organization_memberships VALUES ('company',$1)",
    [userId]
  );
  await database.query(
    "INSERT INTO public.session VALUES ('owner-session',$1,clock_timestamp()+interval '1 hour')",
    [rawUserId]
  );
});

test("personal payer is the exact raw authenticated session user", async () => {
  expect(await resolveWorkspaceBillingSubject(personal)).toEqual({
    subjectType: "user",
    subjectId: rawUserId,
  });
});
test("company member resolves the verified organization, never its own human/issuer fallback", async () => {
  expect(await resolveWorkspaceBillingSubject(company)).toEqual({
    subjectType: "organization",
    subjectId: "company",
  });
});
test("removes exactly one verified namespace prefix, preserving the raw session ID", async () => {
  const raw = "better-auth:raw-account";
  const actor = {
    ...accessScopeForUser(`better-auth:${raw}`),
    authSessionId: "nested-prefix",
  };
  await database.query("INSERT INTO workspaces VALUES ($1,NULL)", [
    actor.workspaceId,
  ]);
  await database.query(
    "INSERT INTO workspace_memberships VALUES ($1,$2,'owner')",
    [actor.workspaceId, actor.userId]
  );
  await database.query(
    "INSERT INTO public.session VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
    [actor.authSessionId, raw]
  );
  expect(await resolveWorkspaceBillingSubject(actor)).toEqual({
    subjectType: "user",
    subjectId: raw,
  });
});
test.each(["expired", "other-user", "missing"] as const)(
  "rejects %s session without fallback",
  async (caseName) => {
    if (caseName === "expired")
      await database.exec(
        "UPDATE public.session SET \"expiresAt\"=clock_timestamp()-interval '1 second'"
      );
    if (caseName === "other-user")
      await database.exec(
        "UPDATE public.session SET \"userId\"='other-account'"
      );
    if (caseName === "missing")
      await database.exec("DELETE FROM public.session");
    await expect(resolveWorkspaceBillingSubject(personal)).rejects.toThrow(
      "WorkspaceAccessDenied"
    );
  }
);
test.each(["workspace", "organization"] as const)(
  "revoked %s membership cannot resolve a company payer",
  async (kind) => {
    if (kind === "workspace")
      await database.exec(
        "DELETE FROM workspace_memberships WHERE workspace_id='company-studio'"
      );
    else await database.exec("DELETE FROM organization_memberships");
    await expect(resolveWorkspaceBillingSubject(company)).rejects.toThrow(
      "WorkspaceAccessDenied"
    );
  }
);
test("foreign personal workspace with even a forged owner row cannot resolve another payer", async () => {
  await database.exec(
    "INSERT INTO workspaces VALUES ('foreign-personal',NULL)"
  );
  await database.query(
    "INSERT INTO workspace_memberships VALUES ('foreign-personal',$1,'owner')",
    [userId]
  );
  await expect(
    resolveWorkspaceBillingSubject({
      ...personal,
      workspaceId: "foreign-personal",
    })
  ).rejects.toThrow("WorkspaceAccessDenied");
});
test.each([
  { authSessionId: undefined, channelIdentityId: "channel" },
  { groupBindingId: "5181c1ac-838c-4a5f-a3d8-1bd971a8548f" },
  { groupEpoch: "5181c1ac-838c-4a5f-a3d8-1bd971a8548f" },
  {
    authSessionId: undefined,
    agentGrantId: "5181c1ac-838c-4a5f-a3d8-1bd971a8548f",
  },
  {
    authSessionId: undefined,
    scheduledRunId: "5181c1ac-838c-4a5f-a3d8-1bd971a8548f",
    scheduledRunLeaseToken: "5181c1ac-838c-4a5f-a3d8-1bd971a8548f",
  },
  { channelIdentityId: "channel" },
  { matrixIdentityId: "@synthetic:example.invalid" },
])(
  "rejects non-app/ambiguous contexts %# without a payer fallback",
  async (context) => {
    await expect(
      resolveWorkspaceBillingSubject({ ...personal, ...context })
    ).rejects.toThrow("WorkspaceAccessDenied");
  }
);
test("database failures propagate; billing UI Free fallback is not admission authority", async () => {
  boundary.query.mockRejectedValueOnce(
    new Error("synthetic database unavailable")
  );
  await expect(resolveWorkspaceBillingSubject(personal)).rejects.toThrow(
    "synthetic database unavailable"
  );
});

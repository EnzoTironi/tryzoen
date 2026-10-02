import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { studioProjectBinding } from "../../tests/fixtures/analytics/postgres-ontology";
import { admitSourceReadBudget, settleSourceReadBudget } from "./source-read";

// Real authorization/accounting SQL on one isolated PGlite connection. The
// transaction queue is NOT proof of PostgreSQL multi-connection advisory locks.
const boundary = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  transaction:
    vi.fn<
      (
        run: () => Promise<unknown>,
        options?: { readonly outermost: true }
      ) => Promise<unknown>
    >(),
  selection: vi.fn<
    () => Promise<{
      revision: string | null;
      documents: { path: string; content: string }[];
    }>
  >(),
  failCommit: false,
  key: Buffer.alloc(32, 1).toString("base64"),
}));
vi.mock("@db/queries", () => ({
  query: boundary.query,
  transaction: boundary.transaction,
}));
vi.mock("../workspaces/repository", () => ({
  WorkspaceRepository: { selection: boundary.selection },
}));
vi.mock("@db/services/installation-secrets", () => ({
  getInstallationSecrets: async () => ({
    secretEncryptionKey: boundary.key,
  }),
}));
const database = new PGlite();
const transactions = new AsyncLocalStorage<{ query: PGlite["query"] }>();
const dialect = new PgDialect();
const actor = {
  ...accessScopeForUser("better-auth:budget-owner"),
  authSessionId: "owner-session",
};
const company = { ...actor, workspaceId: "budget-company" };
const revision = "a".repeat(40);
const binding = studioProjectBinding("f".repeat(64));
const source = {
  path: "knowledge/sources/studio.json",
  revision,
  arguments: { minimum: "15.01" },
};
const native = { sessionId: "budget-native-session", callId: "read-1" };
const selected = () => ({
  revision,
  documents: [{ path: source.path, content: JSON.stringify(binding) }],
});

beforeAll(async () => {
  await database.exec(`CREATE TABLE organizations(id text PRIMARY KEY);
    CREATE TABLE workspaces(id text PRIMARY KEY, organization_id text);
    CREATE TABLE workspace_memberships(workspace_id text, user_id text, role text);
    CREATE TABLE organization_memberships(organization_id text, user_id text);
    CREATE TABLE public.session(id text PRIMARY KEY, "userId" text, "expiresAt" timestamptz);
    CREATE TABLE agent_sessions(session_id text PRIMARY KEY, workspace_id text, created_by_user_id text);
    CREATE TABLE workspace_repository(workspace_id text PRIMARY KEY, head_sha text);
    CREATE TABLE tool_connections(id uuid PRIMARY KEY, revision uuid, workspace_id text, kind text, revoked_at timestamptz, share text, connected_by text);
    CREATE TABLE billing_entitlements(subject_type text, subject_id text, plan text, status text, seat_count integer, stripe_customer_id text, stripe_subscription_id text);`);
  await database.exec(
    await readFile(
      new URL(
        "../../db/migrations/0104_tool-call-allocations.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  boundary.query.mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    return (
      await (transactions.getStore() ?? database).query<
        Record<string, unknown>
      >(compiled.sql, compiled.params)
    ).rows;
  });
  boundary.transaction.mockImplementation(async (run, options) => {
    if (transactions.getStore()) {
      if (options?.outermost)
        throw new Error("Synthetic outermost transaction guard");
      return await run();
    }
    return await database.transaction(async (tx) =>
      transactions.run(tx, async () => {
        const result = await run();
        if (boundary.failCommit)
          throw new Error("Synthetic transaction failure before commit");
        return result;
      })
    );
  });
});
afterAll(async () => {
  await database.close();
});
beforeEach(async () => {
  boundary.failCommit = false;
  boundary.key = Buffer.alloc(32, 1).toString("base64");
  boundary.query.mockClear();
  boundary.transaction.mockClear();
  boundary.selection.mockReset().mockImplementation(async () => selected());
  await database.exec(
    "SET timezone TO 'UTC'; TRUNCATE organizations,workspaces,workspace_memberships,organization_memberships,public.session,agent_sessions,workspace_repository,tool_connections,billing_entitlements,tool_call_allocations,tool_call_accounting"
  );
  await database.query(
    "INSERT INTO organizations VALUES ('budget-organization')"
  );
  await database.query(
    "INSERT INTO workspaces VALUES ($1,NULL),($2,'budget-organization')",
    [actor.workspaceId, company.workspaceId]
  );
  await database.query(
    "INSERT INTO workspace_memberships VALUES ($1,$3,'owner'),($2,$3,'member')",
    [actor.workspaceId, company.workspaceId, actor.userId]
  );
  await database.query(
    "INSERT INTO organization_memberships VALUES ('budget-organization',$1)",
    [actor.userId]
  );
  await database.query(
    "INSERT INTO public.session VALUES ('owner-session','budget-owner',clock_timestamp()+interval '1 hour')"
  );
  await database.query(
    "INSERT INTO agent_sessions VALUES ($1,$2,$3),('company-native-session',$4,$3)",
    [native.sessionId, actor.workspaceId, actor.userId, company.workspaceId]
  );
  await database.query(
    "INSERT INTO workspace_repository VALUES ($1,$3),($2,$3)",
    [actor.workspaceId, company.workspaceId, revision]
  );
  await database.query(
    "INSERT INTO tool_connections VALUES ($1,$2,$3,'postgres',NULL,'owner',$4)",
    [
      binding.connection.id,
      binding.connection.revision,
      actor.workspaceId,
      actor.userId,
    ]
  );
});
async function allocate(callId = native.callId) {
  const result = await admitSourceReadBudget(
    actor,
    { ...native, callId },
    source
  );
  if (result.disposition !== "new")
    throw new Error("Expected fresh synthetic allocation");
  return result;
}
async function stored() {
  return (
    await database.query<{
      status: string;
      consumed_calls: number | null;
      window_date: Date;
    }>(
      "SELECT status,consumed_calls,window_date FROM tool_call_allocations ORDER BY created_at,id"
    )
  ).rows;
}
async function seedCalls(
  receipt: Awaited<ReturnType<typeof allocate>>["receipt"],
  count: number
) {
  for (let i = 0; i < count; i++)
    await database.query(
      `INSERT INTO tool_call_allocations(id,key_fingerprint,operation_hash,request_hash,actor_hash,payer_hash,window_date,status,consumed_calls,settled_at)
    VALUES ($1,(SELECT key_fingerprint FROM tool_call_accounting WHERE id=1),$2,$2,$3,$4,$5,'settled',1,clock_timestamp())`,
      [
        randomUUID(),
        createHash("sha256").update(`synthetic-seed:${i}`).digest("hex"),
        receipt.actorHash,
        receipt.payerHash,
        receipt.windowDate,
      ]
    );
}

test("commits one pinned source allocation, with only opaque budget metadata", async () => {
  const result = await allocate();
  expect(result.published).toEqual({ path: source.path, revision, binding });
  const rows = (await database.query("SELECT * FROM tool_call_allocations"))
    .rows;
  expect(rows).toHaveLength(1);
  const serialized = JSON.stringify(rows);
  for (const value of [
    actor.userId,
    "budget-owner",
    "budget-organization",
    native.sessionId,
    native.callId,
    source.path,
    "15.01",
    "studio",
  ])
    expect(serialized).not.toContain(value);
  expect(
    boundary.query.mock.calls.map(([s]) => dialect.sqlToQuery(s).sql).join(" ")
  ).not.toContain("credentials");
  await expect(stored()).resolves.toMatchObject([
    { status: "reserved", consumed_calls: null },
  ]);
});
test("identical native replay cannot allocate or authorize another dispatch", async () => {
  const first = await allocate();
  const replay = await admitSourceReadBudget(actor, native, source);
  expect(replay).toMatchObject({
    disposition: "replay",
    status: "reserved",
    receipt: first.receipt,
  });
  expect(await stored()).toHaveLength(1);
});
test("native tuple encoding avoids colon-concatenation identity collisions", async () => {
  await database.query(
    "INSERT INTO agent_sessions VALUES ('budget-native-session:read',$1,$2)",
    [actor.workspaceId, actor.userId]
  );
  const a = await admitSourceReadBudget(
    actor,
    { ...native, callId: "read:tail" },
    source
  );
  const b = await admitSourceReadBudget(
    actor,
    { sessionId: "budget-native-session:read", callId: "tail" },
    source
  );
  expect(a.receipt.operationHash).not.toBe(b.receipt.operationHash);
  expect(await stored()).toHaveLength(2);
});
test("changed parameters under an existing native operation fail closed", async () => {
  await allocate();
  await expect(
    admitSourceReadBudget(actor, native, {
      ...source,
      arguments: { minimum: "99.00" },
    })
  ).rejects.toThrow("operation changed");
  expect(await stored()).toHaveLength(1);
});
test("JSON parameter property ordering does not allocate twice", async () => {
  const first = await admitSourceReadBudget(actor, native, {
    ...source,
    arguments: { minimum: "15.01", tag: "x" },
  });
  const second = await admitSourceReadBudget(actor, native, {
    ...source,
    arguments: { tag: "x", minimum: "15.01" },
  });
  expect(second).toMatchObject({
    disposition: "replay",
    receipt: first.receipt,
  });
  expect(await stored()).toHaveLength(1);
});
test.each(["missing", "foreign-workspace", "foreign-owner"] as const)(
  "denies %s native session ownership",
  async (kind) => {
    if (kind === "missing") await database.exec("DELETE FROM agent_sessions");
    if (kind === "foreign-workspace")
      await database.query("UPDATE agent_sessions SET workspace_id=$1", [
        company.workspaceId,
      ]);
    if (kind === "foreign-owner")
      await database.exec(
        "UPDATE agent_sessions SET created_by_user_id='better-auth:foreign'"
      );
    await expect(allocate()).rejects.toThrow("WorkspaceAccessDenied");
    expect(await stored()).toHaveLength(0);
  }
);
test.each(["session", "workspace", "organization"] as const)(
  "revoked %s authority cannot create a budget receipt",
  async (kind) => {
    if (kind === "session") await database.exec("DELETE FROM public.session");
    if (kind === "workspace")
      await database.exec("DELETE FROM workspace_memberships");
    if (kind === "organization")
      await database.exec("DELETE FROM organization_memberships");
    await expect(
      admitSourceReadBudget(
        company,
        { sessionId: "company-native-session", callId: "company-read" },
        source
      )
    ).rejects.toThrow("WorkspaceAccessDenied");
    expect(await stored()).toHaveLength(0);
  }
);
test.each(["absent", "revoked", "revision", "other-owner", "http"] as const)(
  "denies %s connector before allocating",
  async (kind) => {
    if (kind === "absent") await database.exec("DELETE FROM tool_connections");
    if (kind === "revoked")
      await database.exec(
        "UPDATE tool_connections SET revoked_at=clock_timestamp()"
      );
    if (kind === "revision")
      await database.exec(
        "UPDATE tool_connections SET revision=gen_random_uuid()"
      );
    if (kind === "other-owner")
      await database.exec(
        "UPDATE tool_connections SET connected_by='better-auth:foreign'"
      );
    if (kind === "http")
      await database.exec("UPDATE tool_connections SET kind='mcp'");
    await expect(allocate()).rejects.toThrow("WorkspaceAccessDenied");
    expect(await stored()).toHaveLength(0);
  }
);
test.each(["missing-file", "captured-revision", "current-head"] as const)(
  "denies %s publication before allocating",
  async (kind) => {
    if (kind === "missing-file")
      boundary.selection.mockResolvedValue({ revision, documents: [] });
    if (kind === "captured-revision")
      boundary.selection.mockResolvedValue({
        ...selected(),
        revision: "b".repeat(40),
      });
    if (kind === "current-head")
      await database.exec(
        "UPDATE workspace_repository SET head_sha=repeat('b',40)"
      );
    await expect(allocate()).rejects.toThrow("WorkspaceAccessDenied");
    expect(await stored()).toHaveLength(0);
  }
);
test("organization entitlement selects actor limits without a human payer fallback", async () => {
  await database.query("UPDATE tool_connections SET workspace_id=$1", [
    company.workspaceId,
  ]);
  await database.exec(
    "INSERT INTO billing_entitlements VALUES ('organization','budget-organization','pro','active',1,NULL,NULL)"
  );
  const result = await admitSourceReadBudget(
    company,
    { sessionId: "company-native-session", callId: "company-read" },
    source
  );
  expect(result.disposition).toBe("new");
  const entitlementQuery = boundary.query.mock.calls
    .map(([s]) => dialect.sqlToQuery(s))
    .find(({ sql }) => sql.includes("FROM billing_entitlements"));
  expect(entitlementQuery?.params).toEqual([
    "organization",
    "budget-organization",
  ]);
});
test("strict entitlement SQL failure never becomes a Free successful allocation", async () => {
  await database.exec(
    "ALTER TABLE billing_entitlements RENAME TO billing_unavailable"
  );
  try {
    await expect(allocate()).rejects.toThrow(/billing_entitlements/u);
    expect(await stored()).toHaveLength(0);
  } finally {
    await database.exec(
      "ALTER TABLE billing_unavailable RENAME TO billing_entitlements"
    );
  }
});
test("competing requests for the last daily actor call allocate exactly one", async () => {
  const first = await allocate();
  await seedCalls(first.receipt, 198);
  const results = await Promise.allSettled([
    allocate("last-A"),
    allocate("last-B"),
  ]);
  expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1
  );
  expect(
    results
      .filter(({ status }) => status === "rejected")
      .map((r): unknown => (r.status === "rejected" ? r.reason : null))
  ).toMatchObject([
    {
      reason: "exceeded",
      scope: "user",
      resource: "tool_calls",
      limit: 200,
      used: 200,
      requested: 1,
    },
  ]);
  expect(await stored()).toHaveLength(200);
});
test("unknown work holds the last slot rather than refunding it", async () => {
  const first = await allocate();
  await seedCalls(first.receipt, 199);
  await settleSourceReadBudget(first.receipt, "unknown");
  await expect(allocate("no-free-slot")).rejects.toMatchObject({
    reason: "exceeded",
    used: 200,
  });
  expect(
    (await stored()).filter(({ status }) => status === "uncertain")
  ).toHaveLength(1);
});
test("duplicate zero settlement cannot release another operation's reservation", async () => {
  const first = await allocate();
  await allocate("other-active");
  await settleSourceReadBudget(first.receipt, 0);
  await settleSourceReadBudget(first.receipt, 0);
  expect(await stored()).toMatchObject([
    { status: "settled", consumed_calls: 0 },
    { status: "reserved", consumed_calls: null },
  ]);
});
test("spent work survives completion and repeated settlement", async () => {
  const first = await allocate();
  await settleSourceReadBudget(first.receipt, 1);
  await settleSourceReadBudget(first.receipt, 1);
  await expect(settleSourceReadBudget(first.receipt, 0)).rejects.toThrow(
    "operation changed"
  );
  expect(await stored()).toMatchObject([
    { status: "settled", consumed_calls: 1 },
  ]);
});
test("unknown may be resolved by confirmed original work without re-admission", async () => {
  const first = await allocate();
  await settleSourceReadBudget(first.receipt, "unknown");
  expect(await admitSourceReadBudget(actor, native, source)).toMatchObject({
    disposition: "replay",
    status: "uncertain",
  });
  await settleSourceReadBudget(first.receipt, 1);
  await settleSourceReadBudget(first.receipt, "unknown");
  expect(await stored()).toMatchObject([
    { status: "settled", consumed_calls: 1 },
  ]);
});
test("revocation rejects replay while observed consumption can still settle the exact receipt", async () => {
  const first = await allocate();
  await database.exec(
    "DELETE FROM public.session; DELETE FROM tool_connections; DELETE FROM workspace_memberships"
  );
  await expect(admitSourceReadBudget(actor, native, source)).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
  await settleSourceReadBudget(first.receipt, 1);
  expect(await stored()).toMatchObject([
    { status: "settled", consumed_calls: 1 },
  ]);
});
test("forged receipt cannot settle another operation", async () => {
  const first = await allocate();
  const second = await allocate("other");
  await expect(
    settleSourceReadBudget({ ...first.receipt, id: second.receipt.id }, 0)
  ).rejects.toThrow("operation changed");
  expect(await stored()).toMatchObject([
    { status: "reserved", consumed_calls: null },
    { status: "reserved", consumed_calls: null },
  ]);
});
test("rolled-over settlement remains in its original UTC accounting window", async () => {
  const first = await allocate();
  const [old] = (
    await database.query<{ day: string }>(
      "SELECT (CURRENT_DATE - 1)::text AS day"
    )
  ).rows;
  if (!old) throw new Error("Missing synthetic date");
  await database.query(
    "UPDATE tool_call_allocations SET window_date=$1 WHERE id=$2",
    [old.day, first.receipt.id]
  );
  const second = await allocate("today");
  await settleSourceReadBudget({ ...first.receipt, windowDate: old.day }, 0);
  expect(second.receipt.windowDate).toBe(new Date().toISOString().slice(0, 10));
  expect(
    (
      await database.query(
        "SELECT window_date::text AS day,status,consumed_calls FROM tool_call_allocations ORDER BY window_date"
      )
    ).rows
  ).toEqual([
    { day: old.day, status: "settled", consumed_calls: 0 },
    {
      day: second.receipt.windowDate,
      status: "reserved",
      consumed_calls: null,
    },
  ]);
});
test("database timezone cannot shift the UTC quota window", async () => {
  await database.exec("SET timezone TO 'Pacific/Auckland'");
  expect((await allocate()).receipt.windowDate).toBe(
    new Date().toISOString().slice(0, 10)
  );
});
test("transaction failure does not return a dispatch permit or retain a phantom allocation", async () => {
  boundary.failCommit = true;
  await expect(allocate()).rejects.toThrow("before commit");
  expect(await stored()).toHaveLength(0);
});
test("nested admission fails before capture/allocation", async () => {
  await expect(boundary.transaction(async () => allocate())).rejects.toThrow(
    "outermost transaction guard"
  );
  expect(boundary.selection).not.toHaveBeenCalled();
  expect(await stored()).toHaveLength(0);
});
test.each([
  { status: "settled", consumed: null, settled: false },
  { status: "settled", consumed: 2, settled: true },
  { status: "reserved", consumed: 1, settled: false },
  { status: "uncertain", consumed: null, settled: true },
  { status: "invented", consumed: null, settled: false },
])(
  "migration rejects inconsistent budget state %#",
  async ({ status, consumed, settled }) => {
    await expect(
      database.query(
        `INSERT INTO tool_call_allocations(id,key_fingerprint,operation_hash,request_hash,actor_hash,payer_hash,window_date,status,consumed_calls,created_at,settled_at)
      VALUES ($1,repeat('a',64),$2,$2,$2,$2,CURRENT_DATE,$3,$4,clock_timestamp(),$5)`,
        [
          randomUUID(),
          "a".repeat(64),
          status,
          consumed,
          settled ? new Date() : null,
        ]
      )
    ).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toHaveLength(0);
  }
);

test("per-actor usage is shared across payers, while the current verified payer chooses its plan", async () => {
  const first = await allocate();
  await seedCalls(first.receipt, 199);
  const companyConnection = randomUUID();
  await database.query(
    "INSERT INTO tool_connections VALUES ($1,$2,$3,'postgres',NULL,'owner',$4)",
    [
      companyConnection,
      binding.connection.revision,
      company.workspaceId,
      actor.userId,
    ]
  );
  boundary.selection.mockResolvedValue({
    revision,
    documents: [
      {
        path: source.path,
        content: JSON.stringify({
          ...binding,
          connection: { ...binding.connection, id: companyConnection },
        }),
      },
    ],
  });
  await database.exec(
    "INSERT INTO billing_entitlements VALUES ('organization','budget-organization','org','active',50,NULL,NULL)"
  );
  const companyResult = await admitSourceReadBudget(
    company,
    { sessionId: "company-native-session", callId: "org-seat-call" },
    source
  );
  expect(companyResult.disposition).toBe("new");
  expect(companyResult.receipt.actorHash).toBe(first.receipt.actorHash);
  expect(companyResult.receipt.payerHash).not.toBe(first.receipt.payerHash);
  boundary.selection.mockResolvedValue(selected());
  await expect(allocate("back-to-free")).rejects.toMatchObject({
    scope: "user",
    resource: "tool_calls",
    used: 201,
    limit: 200,
  });
  expect(await stored()).toHaveLength(201);
});
test("an inactive paid entitlement falls back to the real Free limit", async () => {
  const first = await allocate();
  await seedCalls(first.receipt, 199);
  await database.exec(
    "INSERT INTO billing_entitlements VALUES ('user','budget-owner','pro','canceled',1,NULL,NULL)"
  );
  await expect(allocate("not-paid-now")).rejects.toMatchObject({
    resource: "tool_calls",
    limit: 200,
    used: 200,
  });
  expect(await stored()).toHaveLength(200);
});

test("key replacement cannot replay a native operation with fresh usage or release its old hold", async () => {
  const first = await allocate();
  boundary.key = Buffer.alloc(32, 2).toString("base64");
  await expect(admitSourceReadBudget(actor, native, source)).rejects.toThrow(
    "budget is unavailable"
  );
  await expect(allocate("another-key-operation")).rejects.toThrow(
    "budget is unavailable"
  );
  expect(await stored()).toMatchObject([
    { status: "reserved", consumed_calls: null },
  ]);
  await settleSourceReadBudget(first.receipt, 1);
  expect(await stored()).toMatchObject([
    { status: "settled", consumed_calls: 1 },
  ]);
});
test.each(["replace", "delete"] as const)(
  "ledger key anchor cannot %s while allocations exist",
  async (kind) => {
    await allocate();
    const statement =
      kind === "replace"
        ? "UPDATE tool_call_accounting SET key_fingerprint=repeat('b',64)"
        : "DELETE FROM tool_call_accounting";
    await expect(database.exec(statement)).rejects.toMatchObject({
      code: "23001",
      constraint: "tool_call_allocations_accounting_key_fkey",
    });
    expect(await stored()).toHaveLength(1);
  }
);

test("unchanged replay after UTC rollover preserves its original receipt and never reserves the new window", async () => {
  const first = await allocate();
  const tomorrow = new Date(Date.now() + 86400000);
  const delegate = boundary.query.getMockImplementation();
  if (!delegate) throw new Error("Missing synthetic query owner");
  boundary.query.mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    if (compiled.sql.includes('AS "createdAt"'))
      return [
        {
          windowDate: tomorrow.toISOString().slice(0, 10),
          createdAt: tomorrow,
        },
      ];
    return await delegate(statement);
  });
  try {
    expect(await admitSourceReadBudget(actor, native, source)).toMatchObject({
      disposition: "replay",
      receipt: first.receipt,
    });
    const next = await allocate("new-window");
    expect(next.receipt.windowDate).toBe(tomorrow.toISOString().slice(0, 10));
    expect(await stored()).toHaveLength(2);
  } finally {
    boundary.query.mockImplementation(delegate);
  }
});
test("nested settlement fails before accounting SQL and leaves its hold intact", async () => {
  const first = await allocate();
  boundary.query.mockClear();
  await expect(
    boundary.transaction(async () => settleSourceReadBudget(first.receipt, 0))
  ).rejects.toThrow("outermost transaction guard");
  expect(boundary.query).not.toHaveBeenCalled();
  expect(await stored()).toMatchObject([
    { status: "reserved", consumed_calls: null },
  ]);
});
test("a mismatched key fingerprint cannot be attached to a new allocation", async () => {
  const first = await allocate();
  await expect(
    database.query(
      `INSERT INTO tool_call_allocations(id,key_fingerprint,operation_hash,request_hash,actor_hash,payer_hash,window_date,status)
    VALUES ($1,repeat('b',64),repeat('c',64),repeat('d',64),$2,$3,$4,'reserved')`,
      [
        randomUUID(),
        first.receipt.actorHash,
        first.receipt.payerHash,
        first.receipt.windowDate,
      ]
    )
  ).rejects.toMatchObject({ code: "23503" });
  expect(await stored()).toHaveLength(1);
});

// Advance only the authorization query's wall clock after blocking accounting
// work. Session row values stay unchanged; SQL SHARE locks cannot stop expiry.
test.each([
  { disposition: "new", wait: "accounting" },
  { disposition: "new", wait: "insert" },
  { disposition: "replay", wait: "accounting" },
] as const)(
  "$disposition denies session expiry after $wait work and rolls back any new hold",
  async ({ disposition, wait }) => {
    if (disposition === "replay") await allocate();
    const before = await stored();
    const sessions = (await database.query("SELECT * FROM public.session"))
      .rows;
    const delegate = boundary.query.getMockImplementation();
    if (!delegate) throw new Error("Missing synthetic query owner");
    let expired = false;
    let initialChecks = 0;
    boundary.query.mockImplementation(async (statement) => {
      const compiled = dialect.sqlToQuery(statement);
      if (compiled.sql.includes("FROM public.session")) {
        if (!expired) initialChecks++;
        if (expired)
          return (
            await (transactions.getStore() ?? database).query<
              Record<string, unknown>
            >(
              compiled.sql.replace(
                "clock_timestamp()",
                "(clock_timestamp() + interval '2 hours')"
              ),
              compiled.params
            )
          ).rows;
      }
      const result = await delegate(statement);
      if (
        (wait === "accounting" &&
          compiled.sql.includes("pg_advisory_xact_lock")) ||
        (wait === "insert" &&
          compiled.sql.includes("INSERT INTO tool_call_allocations"))
      )
        expired = true;
      return result;
    });
    try {
      await expect(
        admitSourceReadBudget(actor, native, source)
      ).rejects.toThrow("WorkspaceAccessDenied");
      expect(initialChecks).toBeGreaterThan(0);
      expect(expired).toBe(true);
      expect(await stored()).toEqual(before);
      expect(
        (await database.query("SELECT * FROM public.session")).rows
      ).toEqual(sessions);
    } finally {
      boundary.query.mockImplementation(delegate);
    }
  }
);

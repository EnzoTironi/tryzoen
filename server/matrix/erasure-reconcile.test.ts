/** Actual reconciliation SQL runs in PGlite; native calls and the outermost guard
 * are mocks. This proves exact receipt/ledger updates, not PostgreSQL lock races
 * or live provider lifecycle behavior. */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { query } from "@db/queries";
import type {
  deactivateMatrixUser,
  matrixConfiguration,
  matrixRequest,
} from "./client";
import { Secret } from "../../shared/environment/secret";

const boundary = vi.hoisted(() => ({
  query: vi.fn<typeof query>(),
  transaction:
    vi.fn<
      <Result>(
        run: () => Promise<Result>,
        options?: { outermost?: boolean }
      ) => Promise<Result>
    >(),
  entered: vi.fn<() => void>(),
  deactivate: vi.fn<typeof deactivateMatrixUser>(),
  configuration: vi.fn<typeof matrixConfiguration>(),
  request: vi.fn<typeof matrixRequest>(),
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock("@db/queries", () => ({
  query: boundary.query,
  transaction: boundary.transaction,
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  deactivateMatrixUser: boundary.deactivate,
  matrixConfiguration: boundary.configuration,
  matrixRequest: boundary.request,
}));

import { transaction } from "@db/queries";
import { MatrixError } from "./client";
import { reconcileMatrixErasures } from "./erasure-reconcile";

const database = new PGlite();
const transactions = new AsyncLocalStorage<Transaction>();
const dialect = new PgDialect();
const bindingId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const ledgerId = "30000000-0000-4000-8000-000000000003";
const owner = "better-auth:synthetic-erasure-owner";
const matrixA = "@synthetic-a:synthetic.invalid";
const matrixB = "@synthetic-b:synthetic.invalid";
const roomId = "!synthetic-room:synthetic.invalid";
const executed: string[] = [];

beforeAll(async () => {
  await database.exec(`
    CREATE TABLE organizations(id text PRIMARY KEY);
    CREATE TABLE workspaces(id text PRIMARY KEY,organization_id text);
    CREATE TABLE workspace_group_bindings(id uuid PRIMARY KEY,workspace_id text,channel text,conversation_id text,installation_id text,epoch uuid,revoked_at timestamptz);
    CREATE TABLE account_deletion_requests(id uuid PRIMARY KEY,user_id text,completed_at timestamptz);
    CREATE TABLE account_deletion_ledger(id uuid PRIMARY KEY,request_id uuid NOT NULL REFERENCES account_deletion_requests(id),surface text NOT NULL,status text NOT NULL,UNIQUE(request_id,surface));
  `);
  await database.exec(
    await readFile(
      new URL("../../db/migrations/0101_matrix-erasure.sql", import.meta.url),
      "utf8"
    )
  );
}, 20_000);

beforeEach(async () => {
  vi.clearAllMocks();
  executed.length = 0;
  await database.exec(
    "TRUNCATE organizations,workspaces,workspace_group_bindings,account_deletion_requests,account_deletion_ledger,matrix_erasure_departures CASCADE"
  );
  await database.query("INSERT INTO organizations VALUES ('synthetic-org')");
  await database.query(
    "INSERT INTO workspaces VALUES ('synthetic-workspace','synthetic-org')"
  );
  await database.query(
    "INSERT INTO workspace_group_bindings VALUES ($1,'synthetic-workspace','matrix',$2,'synthetic.invalid','40000000-0000-4000-8000-000000000004',NULL)",
    [bindingId, roomId]
  );
  await database.query(
    "INSERT INTO account_deletion_requests VALUES ($1,$2,now())",
    [requestId, owner]
  );
  boundary.query.mockReset().mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    executed.push(compiled.sql);
    // PGlite has one connection; advisory-lock syntax is recorded, not proved.
    if (compiled.sql.includes("pg_advisory_xact_lock")) return [];
    return (
      await (transactions.getStore() ?? database).query<
        Record<string, unknown>
      >(compiled.sql, compiled.params)
    ).rows;
  });
  boundary.transaction
    .mockReset()
    .mockImplementation(
      async <Result>(
        run: () => Promise<Result>,
        options?: { outermost?: boolean }
      ) => {
        if (options?.outermost && transactions.getStore())
          throw new Error("An outermost transaction is required");
        boundary.entered();
        return database.transaction((tx) => transactions.run(tx, run));
      }
    );
  boundary.configuration.mockReset().mockResolvedValue({
    serverName: "synthetic.invalid",
    url: "https://matrix.synthetic.invalid/",
    token: new Secret("synthetic-erasure-appservice-token"),
    homeserverToken: new Secret("synthetic-erasure-homeserver-token"),
    botId: "@_zoen_bot:synthetic.invalid",
  });
  boundary.deactivate.mockReset().mockResolvedValue({ deactivated: true });
  boundary.request
    .mockReset()
    .mockImplementation(
      async (method, path): ReturnType<typeof matrixRequest> => {
        if (method === "GET" && path.includes("/state/m.room.member/"))
          return { membership: "leave" };
        if (method === "POST" && path.endsWith("/kick")) return {};
        throw new Error("Unexpected mocked Matrix request");
      }
    );
  boundary.fetch.mockReset().mockImplementation(async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    );
    const name = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    return new Response(
      JSON.stringify({ name, deactivated: true, erased: true }),
      { headers: { "content-type": "application/json" } }
    );
  });
  vi.stubGlobal("fetch", boundary.fetch);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => database.close());

async function ledger(ids = [matrixA]) {
  await database.query(
    "INSERT INTO account_deletion_ledger(id,request_id,surface,status,matrix_ids) VALUES ($1,$2,'matrix','pending_external',$3)",
    [ledgerId, requestId, ids]
  );
}
async function receipt(id = matrixA, future = false) {
  await database.query(
    "INSERT INTO matrix_erasure_departures(binding_id,matrix_id,owner_user_id,native_retry_at) VALUES ($1,$2,$3,now()+$4::interval)",
    [bindingId, id, owner, future ? "1 day" : "-1 minute"]
  );
}
async function currentLedger() {
  return (
    await database.query(
      "SELECT status,matrix_ids FROM account_deletion_ledger WHERE id=$1",
      [ledgerId]
    )
  ).rows;
}
async function currentReceipts() {
  return (
    await database.query(
      "SELECT binding_id,matrix_id,owner_user_id,native_retry_at>now() AS delayed FROM matrix_erasure_departures ORDER BY binding_id,matrix_id"
    )
  ).rows;
}
const deadline = () => Date.now() + 10_000;

describe("exact Matrix erasure reconciliation", () => {
  test("acknowledges a confirmed account erasure without clearing room receipts", async () => {
    await ledger();
    await receipt(matrixA, true);
    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(boundary.deactivate).toHaveBeenCalledExactlyOnceWith(matrixA);
    expect(boundary.fetch).toHaveBeenCalledTimes(1);
    const target = boundary.fetch.mock.calls[0]?.[0];
    const url =
      typeof target === "string"
        ? target
        : target instanceof URL
          ? target.href
          : target?.url;
    expect(url).toContain(
      `/_synapse/admin/v2/users/${encodeURIComponent(matrixA)}`
    );
    expect(await currentLedger()).toEqual([
      { status: "pending_external", matrix_ids: [] },
    ]);
    expect(await currentReceipts()).toEqual([
      {
        binding_id: bindingId,
        matrix_id: matrixA,
        owner_user_id: owner,
        delayed: true,
      },
    ]);
    expect(boundary.request).not.toHaveBeenCalled();
    expect(
      executed.some(
        (sql) => /account_deletion_ledger/u.test(sql) && /FOR UPDATE/u.test(sql)
      )
    ).toBe(true);
  });

  test("marks a no-room Matrix obligation erased after exact account confirmation", async () => {
    await ledger();
    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(await currentLedger()).toEqual([
      { status: "erased", matrix_ids: [] },
    ]);
    expect(await currentReceipts()).toEqual([]);
    expect(boundary.deactivate).toHaveBeenCalledExactlyOnceWith(matrixA);
    expect(boundary.request).not.toHaveBeenCalled();
  });

  test("retains foreign-server handles ahead of a local identity without consuming its limit", async () => {
    const foreignIds = [
      "@synthetic-foreign:foreign.invalid",
      "@synthetic-lookalike:synthetic.invalid.evil",
    ];
    await ledger([...foreignIds, matrixA]);

    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(boundary.deactivate).toHaveBeenCalledExactlyOnceWith(matrixA);
    expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(boundary.request).not.toHaveBeenCalled();
    expect(await currentLedger()).toEqual([
      { status: "pending_external", matrix_ids: foreignIds },
    ]);
  });

  test("retains an earlier foreign-installation receipt without consuming the local room limit", async () => {
    const foreignBindingId = "00000000-0000-4000-8000-000000000001";
    // The local handle suffix qualifies; the foreign installation must exclude it.
    const foreignMatrixId = "@synthetic-foreign:synthetic.invalid";
    await database.query(
      "INSERT INTO workspace_group_bindings VALUES ($1,'synthetic-workspace','matrix','!synthetic-foreign-room:foreign.invalid','foreign.invalid','50000000-0000-4000-8000-000000000005',NULL)",
      [foreignBindingId]
    );
    await database.query(
      "INSERT INTO matrix_erasure_departures(binding_id,matrix_id,owner_user_id,native_retry_at) VALUES ($1,$2,$3,now()-interval '1 day')",
      [foreignBindingId, foreignMatrixId, owner]
    );
    await receipt();

    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(boundary.request).toHaveBeenCalledTimes(2);
    for (const [method, path] of boundary.request.mock.calls) {
      expect(method).toBe("GET");
      expect(path).toContain(encodeURIComponent(roomId));
      expect(path).toContain(encodeURIComponent(matrixA));
    }
    expect(boundary.deactivate).not.toHaveBeenCalled();
    expect(boundary.fetch).not.toHaveBeenCalled();
    expect(await currentReceipts()).toEqual([
      {
        binding_id: foreignBindingId,
        matrix_id: foreignMatrixId,
        owner_user_id: owner,
        delayed: false,
      },
    ]);
  });

  test("subtracts successful A from the latest ledger while concurrently appended B remains pending", async () => {
    await ledger();
    await receipt(matrixA, true);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    boundary.deactivate.mockImplementationOnce(async (id) => {
      expect(id).toBe(matrixA);
      expect(transactions.getStore()).toBeUndefined();
      entered.resolve();
      await release.promise;
      return { deactivated: true };
    });
    const running = reconcileMatrixErasures(deadline(), 1);
    try {
      await entered.promise;
      await database.query(
        "UPDATE account_deletion_ledger SET matrix_ids=$1 WHERE id=$2",
        [[matrixA, matrixB], ledgerId]
      );
      expect(await currentLedger()).toEqual([
        { status: "pending_external", matrix_ids: [matrixA, matrixB] },
      ]);
    } finally {
      release.resolve();
    }
    expect(await running).toBe(1);
    expect(await currentLedger()).toEqual([
      { status: "pending_external", matrix_ids: [matrixB] },
    ]);
    expect(boundary.deactivate).toHaveBeenCalledExactlyOnceWith(matrixA);
    expect(await currentReceipts()).toHaveLength(1);
    expect(
      executed.some(
        (sql) => /account_deletion_ledger/u.test(sql) && /FOR UPDATE/u.test(sql)
      )
    ).toBe(true);
  });

  test.each([
    ["wrong identity", { name: matrixB, deactivated: true, erased: true }],
    ["still active", { name: matrixA, deactivated: false, erased: true }],
    ["not erased", { name: matrixA, deactivated: true, erased: false }],
    ["incomplete evidence", { name: matrixA, deactivated: true }],
  ])("retains the account handle for %s", async (_description, body) => {
    await ledger();
    boundary.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      })
    );
    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(await currentLedger()).toEqual([
      { status: "pending_external", matrix_ids: [matrixA] },
    ]);
  });

  test("retains the account handle when admin lookup returns 404", async () => {
    await ledger();
    boundary.fetch.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(await currentLedger()).toEqual([
      { status: "pending_external", matrix_ids: [matrixA] },
    ]);
  });

  test("retains the account handle when deactivation fails", async () => {
    await ledger();
    boundary.deactivate.mockRejectedValueOnce(
      new MatrixError({ reason: "unavailable" })
    );
    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(await currentLedger()).toEqual([
      { status: "pending_external", matrix_ids: [matrixA] },
    ]);
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  test("rotates a failed identity behind existing handles without losing them", async () => {
    await ledger([matrixA, matrixB]);
    boundary.deactivate.mockRejectedValueOnce(
      new MatrixError({ reason: "unavailable" })
    );
    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(await currentLedger()).toEqual([
      { status: "pending_external", matrix_ids: [matrixB, matrixA] },
    ]);
    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(await currentLedger()).toEqual([
      { status: "pending_external", matrix_ids: [matrixA] },
    ]);
    expect(boundary.deactivate.mock.calls.map(([id]) => id)).toEqual([
      matrixA,
      matrixB,
    ]);
  });

  test("shares the bounded work budget between room receipts and account identities", async () => {
    await ledger([matrixA, matrixB]);
    await receipt(matrixA);
    await receipt(matrixB);
    expect(await reconcileMatrixErasures(deadline(), 2)).toBe(2);
    expect(await currentReceipts()).toEqual([
      {
        binding_id: bindingId,
        matrix_id: matrixB,
        owner_user_id: owner,
        delayed: false,
      },
    ]);
    expect(await currentLedger()).toEqual([
      { status: "pending_external", matrix_ids: [matrixB] },
    ]);
    expect(boundary.deactivate).toHaveBeenCalledExactlyOnceWith(matrixA);
    expect(boundary.request.mock.calls.map(([method]) => method)).toEqual([
      "GET",
      "GET",
    ]);
  });

  test.each(["leave", "ban"] as const)(
    "clears only the exact receipt after verified %s",
    async (membership) => {
      await receipt(matrixA);
      await receipt(matrixB);
      boundary.request.mockResolvedValue({ membership });
      expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
      expect(await currentReceipts()).toEqual([
        {
          binding_id: bindingId,
          matrix_id: matrixB,
          owner_user_id: owner,
          delayed: false,
        },
      ]);
      expect(boundary.deactivate).not.toHaveBeenCalled();
      expect(boundary.fetch).not.toHaveBeenCalled();
      expect(
        boundary.request.mock.calls.every(([method]) => method === "GET")
      ).toBe(true);
    }
  );

  test("requires exact state confirmation after a successful kick", async () => {
    await receipt();
    boundary.request
      .mockResolvedValueOnce({ membership: "join" })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ membership: "leave" });
    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(await currentReceipts()).toEqual([]);
    expect(boundary.request.mock.calls.map(([method]) => method)).toEqual([
      "GET",
      "POST",
      "GET",
    ]);
    expect(boundary.request.mock.calls[1]?.[2]).toMatchObject({
      user_id: matrixA,
    });
  });

  test("refreshes the remaining SQL timeout before both writes after slow native reads", async () => {
    await ledger([]);
    await receipt();
    let currentTime = Date.now();
    const deadlineMs = currentTime + 10_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => currentTime);
    try {
      boundary.request.mockImplementation(
        async (method): ReturnType<typeof matrixRequest> => {
          expect(method).toBe("GET");
          currentTime = deadlineMs - 200;
          return { membership: "leave" };
        }
      );

      expect(await reconcileMatrixErasures(deadlineMs, 1)).toBe(1);
      expect(boundary.request).toHaveBeenCalledTimes(2);
      const statements = boundary.query.mock.calls.map(([statement]) =>
        dialect.sqlToQuery(statement)
      );
      expect(statements[0]?.params).toEqual(["10000"]);
      const writes = [
        statements.findIndex(({ sql }) =>
          sql.startsWith("DELETE FROM matrix_erasure_departures")
        ),
        statements.findIndex(({ sql }) =>
          sql.startsWith("UPDATE account_deletion_ledger l SET status='erased'")
        ),
      ];
      for (const index of writes) {
        expect(index).toBeGreaterThan(0);
        expect(statements[index - 1]?.sql).toContain(
          "set_config('statement_timeout'"
        );
        expect(statements[index - 1]?.params).toEqual(["200"]);
      }
      expect(await currentReceipts()).toEqual([]);
      expect(await currentLedger()).toEqual([
        { status: "erased", matrix_ids: [] },
      ]);
    } finally {
      now.mockRestore();
    }
  });

  test.each(["join", "invite", "knock"] as const)(
    "retains and retries a receipt while native membership remains %s",
    async (membership) => {
      await receipt();
      boundary.request.mockImplementation(
        async (method): ReturnType<typeof matrixRequest> => {
          if (method === "GET") return { membership };
          return {};
        }
      );
      expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
      expect(await currentReceipts()).toEqual([
        {
          binding_id: bindingId,
          matrix_id: matrixA,
          owner_user_id: owner,
          delayed: true,
        },
      ]);
    }
  );

  test("retains and retries a receipt for absent or unavailable native state", async () => {
    await receipt();
    boundary.request.mockRejectedValue(
      new MatrixError({ reason: "not-found" })
    );
    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(await currentReceipts()).toEqual([
      {
        binding_id: bindingId,
        matrix_id: matrixA,
        owner_user_id: owner,
        delayed: true,
      },
    ]);
    boundary.request
      .mockReset()
      .mockRejectedValue(new MatrixError({ reason: "unavailable" }));
    await database.query(
      "UPDATE matrix_erasure_departures SET native_retry_at=now()-interval '1 minute'"
    );
    expect(await reconcileMatrixErasures(deadline(), 1)).toBe(1);
    expect(await currentReceipts()).toHaveLength(1);
  });

  test.each([
    ["expired deadline", -1, 10],
    ["zero budget", 10_000, 0],
  ] as const)(
    "performs no native calls for %s",
    async (_description, remainingMs, budget) => {
      await ledger();
      await receipt();
      expect(
        await reconcileMatrixErasures(Date.now() + remainingMs, budget)
      ).toBe(0);
      expect(boundary.deactivate).not.toHaveBeenCalled();
      expect(boundary.request).not.toHaveBeenCalled();
      expect(boundary.fetch).not.toHaveBeenCalled();
      expect(await currentLedger()).toEqual([
        { status: "pending_external", matrix_ids: [matrixA] },
      ]);
      expect(await currentReceipts()).toHaveLength(1);
    }
  );

  test("refuses an active outer transaction before candidates or native calls", async () => {
    await ledger();
    await receipt();
    await transaction(async () => {
      await expect(reconcileMatrixErasures(deadline(), 2)).rejects.toThrow(
        "outermost"
      );
    });
    expect(boundary.entered).toHaveBeenCalledTimes(1);
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.deactivate).not.toHaveBeenCalled();
    expect(boundary.request).not.toHaveBeenCalled();
    expect(boundary.fetch).not.toHaveBeenCalled();
    expect(await currentLedger()).toEqual([
      { status: "pending_external", matrix_ids: [matrixA] },
    ]);
    expect(await currentReceipts()).toHaveLength(1);
  });
});

import { db } from "@db";
import { query, transaction } from "@db/queries";
import { claimSession } from "@db/services/sessions";
import { sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { expect, test } from "vitest";
import { ontologyPath } from "@zoen/companion-ui/ontology";
import {
  connectTools,
  revokeToolConnection,
} from "../../server/connectors/connections";
import {
  proposeKnowledge,
  reviewKnowledgeProposal,
} from "../../server/workspaces/knowledge";
import {
  admitSourceReadBudget,
  settleSourceReadBudget,
} from "../../server/operations/source-read";
import {
  studioOntology,
  studioProjectBinding,
} from "../fixtures/analytics/postgres-ontology";
import { workspaceFixture, workspaceExecutionFor } from "./workspace-fixture";
import { requireRuntimeDatabase } from "./database";
import { withDeadline } from "../../server/operations/async";

// Real application SQL + native temporary Git, synthetic app/session context.
// No Eve/model turn, warehouse socket, provider cost or physical-cap proof.
// Execute only on an explicitly allocated guarded isolated database with0104.
async function sourceBudgetFixture(scope: "personal" | "company" = "personal") {
  await requireRuntimeDatabase();
  const resources = new AsyncDisposableStack();
  const fixture = await workspaceFixture();
  resources.defer(async () => fixture[Symbol.asyncDispose]());
  const ids = new Set<string>();
  resources.defer(async () => {
    if (ids.size)
      await query(
        sql`DELETE FROM tool_call_allocations WHERE id IN (${sql.join(
          [...ids].map((id) => sql`${id}::uuid`),
          sql`,`
        )})`
      );
  });
  try {
    const actor = scope === "personal" ? fixture.personal : fixture.actor;
    const connection = await connectTools(actor, {
      id: randomUUID(),
      kind: "postgres",
      name: "Synthetic accounting-only source",
      share: "owner",
      configuration: {
        host: "warehouse.example.invalid",
        port: 5432,
        database: "fictional",
        tls: "verify-full",
      },
      credential: {
        username: "synthetic-reader",
        password: "synthetic-no-network-password",
      },
    });
    const binding = {
      ...studioProjectBinding("f".repeat(64)),
      connection: { id: connection.id, revision: connection.revision },
    };
    const path = "knowledge/sources/studio.json";
    const draft = await proposeKnowledge(actor, {
      operationId: randomUUID(),
      expectedRevision: null,
      title: "Synthetic source accounting qualification",
      summary: "Original fictional studio definitions; no live data",
      changes: [
        { path: ontologyPath, content: JSON.stringify(studioOntology) },
        { path, content: JSON.stringify(binding) },
      ],
      dependencies: [],
      evidence: [
        {
          kind: "link",
          url: "https://example.invalid/fictional",
          title: "Original fictional fixture",
          excerpt: "Synthetic studio schema, not external source discovery",
        },
      ],
    });
    const published = await reviewKnowledgeProposal(actor, {
      operationId: randomUUID(),
      expectedRevision: draft.revision,
      proposal: draft.path,
      decision: "approve",
    });
    const execution = workspaceExecutionFor(actor);
    await claimSession(actor, execution.session.id);
    const native = {
      sessionId: execution.session.id,
      callId: execution.callId,
    };
    const source = {
      path,
      revision: published.revision,
      arguments: { minimum: "15.01" },
    };
    const allocate = async (callId = native.callId) => {
      // The existing operation owner propagates this budget into each SQL
      // statement inside admission, including its blocked accounting lock.
      return await withDeadline(async () => {
        const result = await admitSourceReadBudget(
          actor,
          { ...native, callId },
          source
        );
        // Retain the exact cleanup receipt even if the outer operation's clock
        // crosses its deadline immediately after this committed admission.
        ids.add(result.receipt.id);
        return result;
      }, Date.now() + 12000);
    };
    const seed = async (
      receipt: Awaited<ReturnType<typeof allocate>>["receipt"],
      count: number
    ) => {
      for (let i = 0; i < count; i++) {
        const id = randomUUID();
        await query(sql`INSERT INTO tool_call_allocations(id,key_fingerprint,operation_hash,request_hash,actor_hash,payer_hash,window_date,status,consumed_calls,settled_at)
          VALUES (${id},(SELECT key_fingerprint FROM tool_call_accounting WHERE id=1),${createHash("sha256").update(id).digest("hex")},${receipt.requestHash},${receipt.actorHash},${receipt.payerHash},${receipt.windowDate}::date,'settled',1,clock_timestamp())`);
        ids.add(id);
      }
    };
    return {
      actor,
      connection,
      source,
      native,
      allocate,
      seed,
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}

for (const scope of ["personal", "company"] as const) {
  test(`${scope} reviewed file source reserves once and exact consumption settles once`, async () => {
    await using fixture = await sourceBudgetFixture(scope);
    const first = await fixture.allocate();
    expect(first.disposition).toBe("new");
    expect(await fixture.allocate()).toMatchObject({
      disposition: "replay",
      receipt: first.receipt,
      status: "reserved",
    });
    await settleSourceReadBudget(first.receipt, 1);
    await settleSourceReadBudget(first.receipt, 1);
    expect(await fixture.allocate()).toMatchObject({
      disposition: "replay",
      status: "settled",
      consumedCalls: 1,
    });
    await expect(settleSourceReadBudget(first.receipt, 0)).rejects.toThrow(
      "operation changed"
    );
  });
}

test("two actual PostgreSQL connections competing for the final actor call admit exactly one", async () => {
  await using fixture = await sourceBudgetFixture();
  const first = await fixture.allocate();
  await fixture.seed(first.receipt, 198);
  const holder = await db.$client.connect();
  const pending: Promise<Awaited<ReturnType<typeof fixture.allocate>>>[] = [];
  try {
    await holder.query("BEGIN");
    await holder.query("SET LOCAL statement_timeout = '5s'");
    await holder.query("SET LOCAL lock_timeout = '3s'");
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `quota:tool-call:${first.receipt.actorHash}`,
    ]);
    const [lock] = (
      await holder.query<{ classid: number; objid: number }>(
        "SELECT classid,objid FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted"
      )
    ).rows;
    if (!lock) throw new Error("Missing synthetic accounting barrier");
    pending.push(
      fixture.allocate(randomUUID()),
      fixture.allocate(randomUUID())
    );
    // Observe rejections immediately; assertions occur after barrier release.
    const settled = Promise.allSettled(pending);
    const deadline = Date.now() + 5000;
    let waiters: number[] = [];
    while (Date.now() < deadline) {
      waiters = (
        await holder.query<{ pid: number }>(
          "SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=$1::oid AND objid=$2::oid AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())",
          [lock.classid, lock.objid]
        )
      ).rows.map(({ pid }) => pid);
      if (new Set(waiters).size === 2) break;
      await pause(25);
    }
    expect(new Set(waiters).size).toBe(2);
    await holder.query("COMMIT");
    const results = await settled;
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1
    );
    expect(
      results
        .filter(({ status }) => status === "rejected")
        .map((r): unknown => (r.status === "rejected" ? r.reason : null))
    ).toMatchObject([
      { reason: "exceeded", resource: "tool_calls", used: 200, limit: 200 },
    ]);
    const [usage] = await query<{ calls: number }>(
      sql`SELECT SUM(CASE WHEN status='settled' THEN consumed_calls ELSE 1 END)::int AS calls FROM tool_call_allocations WHERE actor_hash=${first.receipt.actorHash} AND window_date=${first.receipt.windowDate}::date`
    );
    expect(usage?.calls).toBe(200);
  } finally {
    try {
      await holder.query("ROLLBACK");
    } finally {
      holder.release(true);
      await Promise.allSettled(pending);
    }
  }
});

test("unknown hold and zero settlement never refund a different pending call", async () => {
  await using fixture = await sourceBudgetFixture();
  const a = await fixture.allocate();
  const b = await fixture.allocate(randomUUID());
  await settleSourceReadBudget(a.receipt, "unknown");
  await settleSourceReadBudget(b.receipt, 0);
  await settleSourceReadBudget(b.receipt, 0);
  const rows = await query<{
    id: string;
    status: string;
    consumed: number | null;
  }>(
    sql`SELECT id,status,consumed_calls AS consumed FROM tool_call_allocations WHERE id IN (${a.receipt.id}::uuid,${b.receipt.id}::uuid)`
  );
  expect(rows).toEqual(
    expect.arrayContaining([
      { id: a.receipt.id, status: "uncertain", consumed: null },
      { id: b.receipt.id, status: "settled", consumed: 0 },
    ])
  );
  expect(rows).toHaveLength(2);
});

test("owner removal/revocation does not erase accounting and observed work can still settle", async () => {
  await using fixture = await sourceBudgetFixture("company");
  const first = await fixture.allocate();
  await revokeToolConnection(fixture.actor, fixture.connection.id);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id=${fixture.actor.workspaceId} AND user_id=${fixture.actor.userId}`
  );
  await expect(fixture.allocate()).rejects.toThrow("WorkspaceAccessDenied");
  await settleSourceReadBudget(first.receipt, 1);
  expect(
    await query(
      sql`SELECT id FROM tool_call_allocations WHERE id=${first.receipt.id}::uuid AND status='settled' AND consumed_calls=1`
    )
  ).toEqual([{ id: first.receipt.id }]);
});

test("actual nested transaction admission/settlement guard retains the original hold", async () => {
  await using fixture = await sourceBudgetFixture();
  const first = await fixture.allocate();
  await expect(
    transaction(async () => fixture.allocate(randomUUID()))
  ).rejects.toThrow("top-level transaction");
  await expect(
    transaction(async () => settleSourceReadBudget(first.receipt, 0))
  ).rejects.toThrow("top-level transaction");
  expect(
    await query(
      sql`SELECT id FROM tool_call_allocations WHERE id=${first.receipt.id}::uuid AND status='reserved' AND consumed_calls IS NULL`
    )
  ).toEqual([{ id: first.receipt.id }]);
});

for (const disposition of ["new", "replay"] as const) {
  test(`${disposition} denies actual session expiry during the PostgreSQL accounting wait`, async () => {
    await using fixture = await sourceBudgetFixture();
    const first = await fixture.allocate();
    const holder = await db.$client.connect();
    const pending: Promise<Awaited<ReturnType<typeof fixture.allocate>>>[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SET LOCAL statement_timeout = '5s'");
      await holder.query("SET LOCAL lock_timeout = '3s'");
      await holder.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`quota:tool-call:${first.receipt.actorHash}`]
      );
      const [lock] = (
        await holder.query<{ classid: number; objid: number }>(
          "SELECT classid,objid FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted"
        )
      ).rows;
      if (!lock) throw new Error("Missing synthetic accounting barrier");
      const [session] = await query<{ expiresAt: Date }>(
        sql`UPDATE public.session SET "expiresAt"=clock_timestamp()+interval '5 seconds' WHERE id=${fixture.actor.authSessionId} RETURNING "expiresAt"`
      );
      expect(session).toBeDefined();
      pending.push(
        fixture.allocate(
          disposition === "replay" ? fixture.native.callId : randomUUID()
        )
      );
      const settled = Promise.allSettled(pending);
      const waiterDeadline = Date.now() + 4000;
      let waiting = false;
      while (Date.now() < waiterDeadline) {
        const rows = await holder.query(
          "SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=$1::oid AND objid=$2::oid AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())",
          [lock.classid, lock.objid]
        );
        if (rows.rowCount === 1) {
          waiting = true;
          break;
        }
        await pause(25);
      }
      // A waiter proves initial authorization passed before natural clock expiry.
      expect(waiting).toBe(true);
      const expiryDeadline = Date.now() + 7000;
      let expired = false;
      while (Date.now() < expiryDeadline) {
        const [clock] = (
          await holder.query<{ expired: boolean }>(
            'SELECT "expiresAt" <= clock_timestamp() AS expired FROM public.session WHERE id=$1',
            [fixture.actor.authSessionId]
          )
        ).rows;
        if (clock?.expired) {
          expired = true;
          break;
        }
        await pause(25);
      }
      expect(expired).toBe(true);
      await holder.query("COMMIT");
      const results = await settled;
      expect(results).toMatchObject([
        { status: "rejected", reason: { name: "WorkspaceAccessDenied" } },
      ]);
      expect(
        await query(
          sql`SELECT id,status FROM tool_call_allocations WHERE actor_hash=${first.receipt.actorHash}`
        )
      ).toEqual([{ id: first.receipt.id, status: "reserved" }]);
      expect(
        await query(
          sql`SELECT "expiresAt" FROM public.session WHERE id=${fixture.actor.authSessionId}`
        )
      ).toEqual([session]);
    } finally {
      try {
        await holder.query("ROLLBACK");
      } finally {
        holder.release(true);
        await Promise.allSettled(pending);
      }
    }
  });
}

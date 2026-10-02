/** SQL-boundary tests only: no provider, runtime, or database connection.
 * Each statement has its own row bound; discovery does not authorize delivery.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pendingMatrixEvents } from "./delivery";
import type { matrixRequest } from "./client";
import type { sendDurableMessage } from "../../agent/lib/durable-delivery";
import type { matrixDeliveryActor } from "./authority";
import type { matrixReplyRelation } from "./replies";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  request: vi.fn<typeof matrixRequest>(),
  send: vi.fn<typeof sendDurableMessage>(),
  authority: vi.fn<typeof matrixDeliveryActor>(),
  reply: vi.fn<typeof matrixReplyRelation>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: async (run: () => Promise<unknown>) => run(),
}));
vi.mock("./replies", () => ({ matrixReplyRelation: mocks.reply }));
vi.mock("../../agent/lib/durable-delivery", () => ({
  sendDurableMessage: mocks.send,
}));
vi.mock("./authority", () => ({
  matrixDeliveryActor: mocks.authority,
  matrixPrincipal: mocks.authority,
  matrixSessionActor: mocks.authority,
  requireMatrixInputNoticeEgress: mocks.authority,
  requireMatrixEgress: mocks.authority,
}));
vi.mock("./client", () => ({
  matrixRequest: mocks.request,
  MatrixEventSchema: {},
  MatrixError: class extends Error {},
}));
vi.mock("../workspaces/access", () => ({
  WorkspaceAccessDenied: class extends Error {},
}));

const dialect = new PgDialect();
const compile = (statement: SQL) => {
  const compiled = dialect.sqlToQuery(statement);
  return { ...compiled, sql: compiled.sql.replace(/\s+/gu, " ").trim() };
};
const obsoletePredicate =
  "b.revoked_at IS NOT NULL OR b.epoch <> d.epoch OR NOT EXISTS (SELECT 1 FROM workspace_memberships m JOIN workspaces w ON w.id = m.workspace_id JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = m.user_id WHERE m.workspace_id = b.workspace_id AND m.user_id = d.user_id)";
const suppressionPredicate = `d.state IN ('pending', 'dispatched', 'answer_ready') AND (${obsoletePredicate})`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
  for (const boundary of [mocks.request, mocks.send, mocks.authority])
    boundary.mockImplementation(() => {
      throw new Error("Discovery must not call a provider or grant authority");
    });
});

describe("bounded pending Matrix event discovery", () => {
  it.each([-1, 26, 1.5, Number.NaN, Infinity, -Infinity, undefined, null, "1"])(
    "rejects invalid or missing limit %s before any SQL",
    async (limit) => {
      await expect(
        Reflect.apply(pendingMatrixEvents, undefined, [limit])
      ).rejects.toThrow(RangeError);
      expect(mocks.query).not.toHaveBeenCalled();
    }
  );

  it("does no SQL for the explicit zero budget", async () => {
    await expect(pendingMatrixEvents(0)).resolves.toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each([1, 7, 25])(
    "bounds cleanup and discovery separately with the supplied limit %s",
    async (limit) => {
      const events = [{ eventId: "$synthetic-event", state: "pending" }];
      mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce(events);
      await expect(pendingMatrixEvents(limit)).resolves.toBe(events);
      expect(mocks.query).toHaveBeenCalledTimes(2);
      const [cleanupCall, discoveryCall] = mocks.query.mock.calls;
      if (!cleanupCall || !discoveryCall)
        throw new Error("Expected cleanup and discovery SQL calls");
      const cleanup = compile(cleanupCall[0]);
      const discovery = compile(discoveryCall[0]);
      expect(cleanup.params).toEqual([limit]);
      expect(cleanup.sql).toMatch(/^WITH stale AS \(SELECT d\.event_id /u);
      expect(cleanup.sql).toContain(
        "ORDER BY d.created_at, d.event_id LIMIT $1 FOR UPDATE OF d SKIP LOCKED"
      );
      expect(cleanup.sql).toContain(
        "UPDATE matrix_deliveries d SET state = 'suppressed', output = NULL, updated_at = now()"
      );
      expect(cleanup.sql).toContain("d.event_id = stale.event_id");
      // Selection and update both preserve the actual revocation/epoch/member
      // predicate, rather than turning a prior candidate id into suppression authority.
      expect(cleanup.sql.split(suppressionPredicate)).toHaveLength(3);
      expect(discovery.params).toEqual([limit]);
      expect(discovery.sql).toContain(
        `d.state IN ('pending', 'answer_ready') AND NOT (${obsoletePredicate})`
      );
      expect(discovery.sql).toContain(
        "ORDER BY d.created_at, d.event_id LIMIT $1"
      );
      expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.authority).not.toHaveBeenCalled();
    }
  );

  it("awaits cleanup before starting discovery", async () => {
    const entered = Promise.withResolvers<void>();
    const complete = Promise.withResolvers<Record<string, unknown>[]>();
    mocks.query.mockImplementationOnce(async () => {
      entered.resolve();
      return await complete.promise;
    });
    const pending = pendingMatrixEvents(2);
    try {
      await entered.promise;
      expect(mocks.query).toHaveBeenCalledTimes(1);
    } finally {
      complete.resolve([]);
    }
    await expect(pending).resolves.toEqual([]);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("preserves cleanup failure and never starts discovery afterward", async () => {
    const failure = new Error("Synthetic cleanup transaction failure");
    mocks.query.mockRejectedValueOnce(failure);
    await expect(pendingMatrixEvents(1)).rejects.toBe(failure);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("preserves discovery failure without a provider effect", async () => {
    const failure = new Error("Synthetic discovery transaction failure");
    mocks.query.mockResolvedValueOnce([]).mockRejectedValueOnce(failure);
    await expect(pendingMatrixEvents(1)).rejects.toBe(failure);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

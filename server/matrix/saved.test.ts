import { createHash, randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { listSavedMatrixMessages, setSavedMatrixMessage } from "./saved";
import type { matrixRequest } from "./client";
import type { requireWorkspaceAccess } from "../workspaces/access";
import type { ensureMatrixIdentity } from "./identities";
const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  request: vi.fn<typeof matrixRequest>(),
  access: vi.fn<typeof requireWorkspaceAccess>(),
  identity: vi.fn<typeof ensureMatrixIdentity>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: (run: () => Promise<unknown>) => run(),
}));
vi.mock("./identities", () => ({
  ensureMatrixIdentity: mocks.identity,
}));
vi.mock("./inbox", () => ({ authorizedInboxRooms: async () => sql`` }));
vi.mock("../workspaces/access", async (original) => ({
  ...(await original<typeof import("../workspaces/access")>()),
  requireWorkspaceAccess: mocks.access,
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({ botId: "@bot:test" }),
}));
beforeEach(() => {
  mocks.query.mockReset().mockResolvedValue([]);
  mocks.request.mockReset();
  mocks.access.mockReset().mockResolvedValue({
    userId: "viewer",
    workspaceId: "space",
    authSessionId: "session",
    role: "member",
    organizationId: "organization",
  });
  mocks.identity.mockReset().mockResolvedValue("@viewer:test");
});
it("drops source metadata if membership disappears during exact-event hydration", async () => {
  const id = randomUUID();
  const key = randomUUID();
  const room = {
    id,
    roomId: "!room:test",
    label: "Private team",
    kind: "group",
    workspaceId: "workspace",
    epoch: randomUUID(),
  };
  mocks.query.mockResolvedValueOnce([room]).mockResolvedValueOnce([]);
  mocks.request
    .mockResolvedValueOnce({
      version: 1,
      items: [
        {
          key,
          workspaceId: "space",
          id,
          roomId: room.roomId,
          eventId: "$event",
          savedAt: 1,
        },
      ],
    })
    .mockResolvedValueOnce({
      event_id: "$event",
      room_id: room.roomId,
      type: "m.room.message",
      sender: "@sender:test",
      content: { msgtype: "m.text", body: "Private text" },
    });
  const result = await listSavedMatrixMessages(
    { userId: "viewer", workspaceId: "space", authSessionId: "session" },
    {}
  );
  expect(result.items).toEqual([
    {
      key,
      reference: { id, messageId: "$event" },
      savedAt: 1,
      room: null,
      message: null,
    },
  ]);
  expect(JSON.stringify(result)).not.toContain("Private");
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.access).toHaveBeenCalledTimes(2);
});

/** Real admission helper, owning SQL/identity/transport mocks only. This
 * deterministic call order does not prove PostgreSQL lock concurrency. */
it("admits the organization and room before the saved mutex and membership checks on an idempotent retry", async () => {
  const actor = {
    userId: "viewer",
    workspaceId: "space",
    authSessionId: "session",
  };
  const id = randomUUID();
  const saved = { version: 1, items: [] };
  const revision = createHash("sha256")
    .update(JSON.stringify(saved))
    .digest("hex");
  const order: string[] = [];
  const dialect = new PgDialect();
  mocks.query.mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    if (
      compiled.sql.includes('w.id AS "workspaceId"') &&
      compiled.sql.includes('w.organization_id AS "organizationId"')
    )
      return [
        { workspaceId: actor.workspaceId, organizationId: "organization" },
      ];
    if (compiled.sql.includes("FROM organizations")) {
      order.push("organization");
      return [{ id: "organization" }];
    }
    if (compiled.sql.includes("pg_advisory_xact_lock")) {
      if (compiled.sql.includes(", 5)")) {
        order.push("room");
      } else {
        order.push("saved-mutex");
      }
      return [];
    }
    throw new Error(`Unexpected SQL in saved entry harness: ${compiled.sql}`);
  });
  mocks.access.mockImplementation(async () => {
    order.push("membership");
    return { ...actor, role: "member", organizationId: "organization" };
  });
  mocks.identity.mockImplementation(async () => {
    order.push("identity");
    return "@viewer:test";
  });
  mocks.request.mockImplementation(async (method) => {
    if (method !== "GET")
      throw new Error(
        "An unchanged saved reference must not publish account data."
      );
    order.push("account-data");
    return saved;
  });
  expect(
    await setSavedMatrixMessage(actor, {
      id,
      messageId: "$event",
      saved: false,
      expectedRevision: revision,
    })
  ).toEqual({ status: "saved", revision });
  expect(order).toEqual([
    "organization",
    "room",
    "saved-mutex",
    "membership",
    "identity",
    "account-data",
  ]);
  const statements = mocks.query.mock.calls.map(([statement]) =>
    dialect.sqlToQuery(statement)
  );
  const organizations = statements.filter((statement) =>
    statement.sql.includes("FROM organizations")
  );
  expect(organizations).toHaveLength(1);
  expect(organizations[0]?.sql).toContain("FOR SHARE");
  expect(organizations[0]?.params).toEqual(["organization"]);
  expect(
    statements
      .filter((statement) => statement.sql.includes("pg_advisory_xact_lock"))
      .map((statement) => statement.params)
  ).toEqual([[id], [JSON.stringify(["matrix-saved", actor.userId])]]);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

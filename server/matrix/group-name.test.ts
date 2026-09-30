/** Real room/admission/rename functions; only SQL and provider boundaries are
 * mocked. Lock recording proves acquisition order, not actual database blocking.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { matrixRequest } from "./client";
import { MatrixError } from "./client";
import { renameMatrixRoom } from "./group-name";
import { WorkspaceAccessDenied } from "../workspaces/access";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  request: vi.fn<typeof matrixRequest>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: async <Result>(run: () => Promise<Result>) => run(),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({
    botId: "@zoen:synthetic.invalid",
    serverName: "synthetic.invalid",
  }),
}));

const actor = {
  userId: "better-auth:synthetic-admin",
  workspaceId: "synthetic-workspace",
  authSessionId: "synthetic-session",
};
const input = {
  id: "10000000-0000-4000-8000-000000000001",
  expectedName: "Old team",
  name: "New team",
};
const room = {
  id: input.id,
  workspaceId: actor.workspaceId,
  roomId: "!synthetic-room:synthetic.invalid",
  label: input.expectedName,
  kind: "group",
  epoch: "20000000-0000-4000-8000-000000000001",
};
const trace: string[] = [];
const dialect = new PgDialect();
let organizationPresent = true;
let authorized = true;
let label = input.expectedName;
let observedName = input.name;

function rows(statement: SQL) {
  const compiled = dialect.sqlToQuery(statement);
  const text = compiled.sql.replace(/\s+/gu, " ").trim();
  const params = compiled.params;
  if (
    text.startsWith(
      'SELECT w.id AS "workspaceId", w.organization_id AS "organizationId"'
    )
  ) {
    trace.push("locator");
    expect(params).toEqual([actor.workspaceId, input.id]);
    return [
      { workspaceId: actor.workspaceId, organizationId: "synthetic-org" },
    ];
  }
  if (text.startsWith("SELECT id FROM organizations")) {
    trace.push("organization");
    expect(params).toEqual(["synthetic-org"]);
    expect(text).toContain("FOR SHARE");
    return organizationPresent ? [{ id: "synthetic-org" }] : [];
  }
  if (text.startsWith("SELECT pg_advisory_xact_lock")) {
    trace.push("room-fence");
    expect(text).toContain(", 5)");
    expect(params).toEqual([input.id]);
    return [];
  }
  if (text.startsWith("SELECT m.role, w.organization_id")) {
    trace.push("authority");
    expect(params).toEqual([actor.userId, actor.workspaceId]);
    return authorized
      ? [{ role: "owner", organization_id: "synthetic-org" }]
      : [];
  }
  if (text.startsWith("SELECT user_id FROM organization_memberships"))
    return [{ user_id: actor.userId }];
  if (text.startsWith("SELECT id FROM public.session"))
    return [{ id: actor.authSessionId }];
  if (text.startsWith('SELECT id, workspace_id AS "workspaceId"')) {
    trace.push("binding-authority");
    expect(params).toEqual([input.id, actor.workspaceId, "synthetic.invalid"]);
    return [{ ...room, label }];
  }
  if (text.startsWith("UPDATE workspace_group_bindings SET label")) {
    trace.push("metadata-write");
    expect(params).toEqual([input.name, input.id, actor.workspaceId]);
    label = input.name;
    return [];
  }
  throw new Error(`Unexpected SQL in mocked name admission: ${text}`);
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Real providers are forbidden in this acceptance test.");
  });
  trace.length = 0;
  organizationPresent = true;
  authorized = true;
  label = input.expectedName;
  observedName = input.name;
  mocks.query
    .mockReset()
    .mockImplementation(async (statement) => rows(statement));
  mocks.request
    .mockReset()
    .mockImplementation(
      async (method, path, body): ReturnType<typeof matrixRequest> => {
        trace.push(`provider:${method}`);
        z.literal(
          `rooms/${encodeURIComponent(room.roomId)}/state/m.room.name`
        ).parse(path);
        if (method === "PUT") {
          z.object({ name: z.literal(input.name) }).parse(body);
          return {};
        }
        if (method === "GET") return { name: observedName };
        throw new Error("Unexpected mocked name provider method.");
      }
    );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("takes organization then room fences before authority, native mutation and local metadata", async () => {
  const result = await renameMatrixRoom(actor, input);
  expect(trace[0]).toBe("locator");
  expect(trace.indexOf("organization")).toBeLessThan(
    trace.indexOf("room-fence")
  );
  expect(trace.indexOf("room-fence")).toBeLessThan(trace.indexOf("authority"));
  expect(trace.indexOf("binding-authority")).toBeLessThan(
    trace.indexOf("provider:PUT")
  );
  expect(trace.indexOf("provider:GET")).toBeLessThan(
    trace.indexOf("metadata-write")
  );
  expect(result).toMatchObject({
    status: "saved",
    room: { ...room, label: input.name },
  });
});

it("takes no room or member lock and performs no provider I/O if the organization fence cannot be acquired", async () => {
  organizationPresent = false;
  await expect(renameMatrixRoom(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(trace).not.toContain("room-fence");
  expect(trace).not.toContain("authority");
  expect(trace).not.toContain("metadata-write");
  expect(mocks.request).not.toHaveBeenCalled();
});

it("preserves admin authorization denial before provider mutation", async () => {
  authorized = false;
  await expect(renameMatrixRoom(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(mocks.request).not.toHaveBeenCalled();
  expect(label).toBe(input.expectedName);
});

it("returns the current room on a stale expected name without provider mutation", async () => {
  label = "Changed by another admin";
  const result = await renameMatrixRoom(actor, input);
  expect(result).toMatchObject({ status: "conflict", room: { label } });
  expect(mocks.request).not.toHaveBeenCalled();
  expect(trace).not.toContain("metadata-write");
});

it("keeps already-saved rename replay free of provider mutation", async () => {
  label = input.name;
  const result = await renameMatrixRoom(actor, input);
  expect(result).toMatchObject({
    status: "saved",
    room: { label: input.name },
  });
  expect(mocks.request).not.toHaveBeenCalled();
  expect(trace).not.toContain("metadata-write");
});

it("withholds local metadata if exact native confirmation differs", async () => {
  observedName = "Different native name";
  await expect(renameMatrixRoom(actor, input)).rejects.toThrow(MatrixError);
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(trace).not.toContain("metadata-write");
  expect(label).toBe(input.expectedName);
});

import { beforeEach, expect, test, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { transaction, type query } from "@db/queries";
import { lockMatrixAdmission } from "./authority";
import { MatrixError } from "./client";
import {
  readThreadSubscription,
  setThreadSubscription,
} from "./thread-subscriptions";
import { WorkspaceAccessDenied } from "../workspaces/access";

const mocks = vi.hoisted(() => ({
  join: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  access: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  message: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  request: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  query: vi.fn<typeof query>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: (run: () => Promise<unknown>) => run(),
}));
vi.mock("./rooms", () => ({
  joinMatrixRoom: mocks.join,
  requireMatrixRoom: mocks.access,
}));
vi.mock("./messages", () => ({ readRoomMessage: mocks.message }));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
}));
const dialect = new PgDialect();
const admissionOrder: string[] = [];
const actor = {
  userId: "viewer",
  authSessionId: "session",
  workspaceId: "workspace",
};
const input = { id: "00000000-0000-4000-8000-000000000001", rootId: "$root" };
function admissionRows(statement: Parameters<typeof query>[0]) {
  const { sql: raw, params } = dialect.sqlToQuery(statement);
  const text = raw.replace(/\s+/gu, " ").trim();
  if (text.startsWith('SELECT w.id AS "workspaceId"')) {
    expect(params).toEqual([actor.workspaceId, input.id]);
    admissionOrder.push("locate");
    return [{ workspaceId: actor.workspaceId, organizationId: "organization" }];
  }
  if (text.startsWith("SELECT id FROM organizations")) {
    expect(params).toEqual(["organization"]);
    expect(text).toContain("FOR SHARE");
    admissionOrder.push("organization");
    return [{ id: "organization" }];
  }
  if (
    text.startsWith("SELECT pg_advisory_xact_lock") &&
    text.includes(", 5)")
  ) {
    expect(params).toEqual([input.id]);
    admissionOrder.push("room");
    return [];
  }
  if (
    text.startsWith("SELECT pg_advisory_xact_lock") &&
    text.includes(", 0)")
  ) {
    expect(params).toEqual([
      `matrix-thread-subscription:${actor.userId}:${input.id}:${input.rootId}`,
    ]);
    admissionOrder.push("subscription");
    return [];
  }
  throw new Error(`Unexpected subscription admission SQL: ${text}`);
}
beforeEach(() => {
  mocks.join
    .mockReset()
    .mockResolvedValue({ roomId: "!room:test", matrixId: "@viewer:test" });
  mocks.access.mockReset().mockResolvedValue({});
  mocks.message.mockReset().mockResolvedValue({ content: {} });
  mocks.request.mockReset();
  admissionOrder.length = 0;
  mocks.query
    .mockReset()
    .mockImplementation(async (statement) => admissionRows(statement));
});
test("unsupported homeservers never expose a synthetic subscription", async () => {
  mocks.request.mockResolvedValue({
    unstable_features: { "org.matrix.msc4306": false },
  });
  expect(await readThreadSubscription(actor, input)).toEqual({
    status: "unsupported",
  });
  expect(
    await setThreadSubscription(actor, { ...input, following: true })
  ).toEqual({ status: "unsupported" });
  expect(
    mocks.request.mock.calls.every(
      ([method, path]) => method === "GET" && path === "versions"
    )
  ).toBe(true);
});
test("missing subscription is distinct from provider failure", async () => {
  mocks.request
    .mockResolvedValueOnce({
      unstable_features: { "org.matrix.msc4306": true },
    })
    .mockRejectedValueOnce(new MatrixError({ reason: "not-found" }));
  expect(await readThreadSubscription(actor, input)).toEqual({
    status: "ready",
    following: false,
    automatic: false,
  });
  mocks.request
    .mockResolvedValueOnce({
      unstable_features: { "org.matrix.msc4306": true },
    })
    .mockRejectedValueOnce(new MatrixError({ reason: "unavailable" }));
  await expect(readThreadSubscription(actor, input)).rejects.toThrow(
    MatrixError
  );
});
test("a thread reply cannot be substituted for its root and revoked reads fail", async () => {
  mocks.message.mockResolvedValue({
    content: {
      "m.relates_to": { rel_type: "m.thread", event_id: "$different" },
    },
  });
  await expect(readThreadSubscription(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.message.mockResolvedValue({ content: {} });
  mocks.request
    .mockResolvedValueOnce({
      unstable_features: { "org.matrix.msc4306": true },
    })
    .mockResolvedValueOnce({ automatic: false });
  mocks.access
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(readThreadSubscription(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );
});

test.each(["manual", "nested automatic"])(
  "%s subscription acquires the room fence before its subscription lock",
  async (mode) => {
    const automatic = mode === "nested automatic";
    mocks.join.mockImplementation(async () => {
      admissionOrder.push("join");
      return { roomId: "!room:test", matrixId: "@viewer:test" };
    });
    mocks.message.mockImplementation(async (_room, eventId) =>
      eventId === "$cause"
        ? {
            sender: "@viewer:test",
            content: {
              "m.relates_to": { rel_type: "m.thread", event_id: input.rootId },
            },
          }
        : { content: {} }
    );
    mocks.request.mockImplementation(async (method, path) => {
      if (path === "versions")
        return { unstable_features: { "org.matrix.msc4306": true } };
      if (method === "PUT") return {};
      return { automatic };
    });
    const write = () =>
      setThreadSubscription(
        actor,
        { ...input, following: true },
        automatic ? "$cause" : undefined
      );
    const result = automatic
      ? await transaction(async () => {
          // Synthetic nested composition retains the room fence; standalone send commits before autosubscribe.
          await lockMatrixAdmission([actor.workspaceId], [input.id]);
          return write();
        })
      : await write();
    expect(result).toEqual({ status: "ready", following: true, automatic });
    const admission = ["locate", "organization", "room", "locate"];
    expect(admissionOrder).toEqual([
      ...(automatic ? admission : []),
      ...admission,
      "subscription",
      "join",
    ]);
    expect(mocks.request).toHaveBeenCalledWith(
      "PUT",
      "rooms/!room%3Atest/thread/%24root/subscription",
      automatic ? { automatic: "$cause" } : {},
      "@viewer:test",
      { version: "unstable/io.element.msc4306", maxResponseBytes: 4096 }
    );
  }
);

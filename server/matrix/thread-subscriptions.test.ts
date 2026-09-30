/** Caller harness: mocked room authority, exact-event reads and provider transport.
 * The real admission fence uses mocked SQL. This does not prove the joined gate
 * itself or native membership/concurrency; those belong to the gate owner's tests.
 */
import { beforeEach, expect, test, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { transaction, type query } from "@db/queries";
import { lockMatrixAdmission } from "./authority";
import { MatrixError, MatrixEventSchema, type matrixRequest } from "./client";
import type {
  joinMatrixRoom,
  requireJoinedMatrixRoom,
  requireMatrixRoom,
} from "./rooms";
import type { readRoomMessage } from "./messages";
import {
  readThreadSubscription,
  setThreadSubscription,
} from "./thread-subscriptions";
import { WorkspaceAccessDenied } from "../workspaces/access";

const mocks = vi.hoisted(() => ({
  join: vi.fn<typeof joinMatrixRoom>(),
  joined: vi.fn<typeof requireJoinedMatrixRoom>(),
  access: vi.fn<typeof requireMatrixRoom>(),
  message: vi.fn<typeof readRoomMessage>(),
  request: vi.fn<typeof matrixRequest>(),
  query: vi.fn<typeof query>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: (run: () => Promise<unknown>) => run(),
}));
vi.mock("./rooms", () => ({
  joinMatrixRoom: mocks.join,
  requireJoinedMatrixRoom: mocks.joined,
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
const room = {
  id: input.id,
  workspaceId: actor.workspaceId,
  roomId: "!room:test",
  label: "Synthetic group",
  epoch: "00000000-0000-4000-8000-000000000002",
  kind: "group",
  matrixId: "@viewer:test",
} satisfies Awaited<ReturnType<typeof requireJoinedMatrixRoom>>;
const rootMessage = MatrixEventSchema.parse({
  event_id: input.rootId,
  room_id: room.roomId,
  type: "m.room.message",
  sender: "@someone:test",
  content: { body: "Synthetic thread root" },
});
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
    .mockRejectedValue(
      new Error("Unexpected autojoin from subscription caller")
    );
  mocks.joined.mockReset().mockResolvedValue(room);
  mocks.access
    .mockReset()
    .mockRejectedValue(
      new Error("Unexpected loose room authority from subscription caller")
    );
  mocks.message.mockReset().mockResolvedValue(rootMessage);
  mocks.request.mockReset();
  admissionOrder.length = 0;
  mocks.query
    .mockReset()
    .mockImplementation(async (statement) => admissionRows(statement));
});

test.each(
  ["pending", "absent-native"].flatMap((reason) =>
    ["read", "manual write", "automatic write"].map((operation) => ({
      reason,
      operation,
    }))
  )
)(
  "$reason receiver denies $operation before event reads or transport",
  async ({ operation }) => {
    mocks.joined.mockRejectedValueOnce(new WorkspaceAccessDenied());
    const run =
      operation === "read"
        ? readThreadSubscription(actor, input)
        : setThreadSubscription(
            actor,
            { ...input, following: true },
            operation === "automatic write" ? "$cause" : undefined
          );
    await expect(run).rejects.toThrow(WorkspaceAccessDenied);
    expect(mocks.joined).toHaveBeenCalledExactlyOnceWith(actor, input.id);
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.join).not.toHaveBeenCalled();
  }
);

test.each(
  [2, 3].flatMap((check) =>
    ["read", "manual write", "automatic write"].map((operation) => ({
      check,
      operation,
    }))
  )
)(
  "strict gate check $check rejects $operation at its recheck",
  async ({ check, operation }) => {
    for (let accepted = 1; accepted < check; accepted++)
      mocks.joined.mockResolvedValueOnce(room);
    mocks.joined.mockRejectedValueOnce(new WorkspaceAccessDenied());
    mocks.message.mockImplementation(async (_room, eventId) =>
      eventId === "$cause"
        ? {
            ...rootMessage,
            event_id: "$cause",
            sender: room.matrixId,
            content: {
              "m.relates_to": { rel_type: "m.thread", event_id: input.rootId },
            },
          }
        : rootMessage
    );
    mocks.request.mockImplementation(
      async (method, path): ReturnType<typeof matrixRequest> => {
        if (path === "versions")
          return { unstable_features: { "org.matrix.msc4306": true } };
        if (method === "PUT") return {};
        return { automatic: operation === "automatic write" };
      }
    );
    const run =
      operation === "read"
        ? readThreadSubscription(actor, input)
        : setThreadSubscription(
            actor,
            { ...input, following: true },
            operation === "automatic write" ? "$cause" : undefined
          );
    await expect(run).rejects.toThrow(WorkspaceAccessDenied);
    expect(mocks.joined.mock.calls).toEqual(
      Array.from({ length: check }, () => [actor, input.id])
    );
    expect(mocks.message.mock.calls).toEqual(
      check === 3 && operation === "automatic write"
        ? [
            [room, input.rootId, true],
            [room, "$cause", true],
          ]
        : [[room, input.rootId, true]]
    );
    const subscriptionPath = "rooms/!room%3Atest/thread/%24root/subscription";
    const options = {
      version: "unstable/io.element.msc4306",
      maxResponseBytes: 4096,
    };
    const subscriptionRead = [
      "GET",
      subscriptionPath,
      undefined,
      room.matrixId,
      options,
    ];
    const subscriptionWrite = [
      "PUT",
      subscriptionPath,
      operation === "automatic write" ? { automatic: "$cause" } : {},
      room.matrixId,
      options,
    ];
    // The third gate withholds the result; write modes have already issued their PUT.
    expect(mocks.request.mock.calls).toEqual([
      [
        "GET",
        "versions",
        undefined,
        undefined,
        { version: "", maxResponseBytes: 16_384 },
      ],
      ...(check === 2
        ? []
        : operation === "read"
          ? [subscriptionRead]
          : [subscriptionWrite, subscriptionRead]),
    ]);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.join).not.toHaveBeenCalled();
  }
);

test("a ready existing receiver can read its exact thread subscription", async () => {
  mocks.request
    .mockResolvedValueOnce({
      unstable_features: { "org.matrix.msc4306": true },
    })
    .mockResolvedValueOnce({ automatic: false });
  expect(await readThreadSubscription(actor, input)).toEqual({
    status: "ready",
    following: true,
    automatic: false,
  });
  expect(mocks.joined.mock.calls).toEqual(
    Array.from({ length: 3 }, () => [actor, input.id])
  );
  expect(mocks.message).toHaveBeenCalledExactlyOnceWith(
    room,
    input.rootId,
    true
  );
  expect(mocks.request).toHaveBeenLastCalledWith(
    "GET",
    "rooms/!room%3Atest/thread/%24root/subscription",
    undefined,
    room.matrixId,
    { version: "unstable/io.element.msc4306", maxResponseBytes: 4096 }
  );
  expect(mocks.access).not.toHaveBeenCalled();
  expect(mocks.join).not.toHaveBeenCalled();
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
  expect(mocks.access).not.toHaveBeenCalled();
  expect(mocks.join).not.toHaveBeenCalled();
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
  expect(mocks.access).not.toHaveBeenCalled();
  expect(mocks.join).not.toHaveBeenCalled();
});
test("a thread reply cannot be substituted for its root and revoked reads fail", async () => {
  mocks.message.mockResolvedValue({
    ...rootMessage,
    content: {
      "m.relates_to": { rel_type: "m.thread", event_id: "$different" },
    },
  });
  await expect(readThreadSubscription(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.message.mockResolvedValue(rootMessage);
  mocks.request
    .mockResolvedValueOnce({
      unstable_features: { "org.matrix.msc4306": true },
    })
    .mockResolvedValueOnce({ automatic: false });
  mocks.joined
    .mockClear()
    .mockResolvedValueOnce(room)
    .mockResolvedValueOnce(room)
    .mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(readThreadSubscription(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(mocks.joined.mock.calls).toEqual(
    Array.from({ length: 3 }, () => [actor, input.id])
  );
  expect(mocks.request).toHaveBeenLastCalledWith(
    "GET",
    "rooms/!room%3Atest/thread/%24root/subscription",
    undefined,
    room.matrixId,
    { version: "unstable/io.element.msc4306", maxResponseBytes: 4096 }
  );
  expect(mocks.access).not.toHaveBeenCalled();
  expect(mocks.join).not.toHaveBeenCalled();
});

test.each(["manual", "nested automatic"])(
  "%s subscription acquires the room fence before its subscription lock",
  async (mode) => {
    const automatic = mode === "nested automatic";
    mocks.joined.mockImplementation(async () => {
      admissionOrder.push("joined");
      return room;
    });
    mocks.message.mockImplementation(async (_room, eventId) =>
      eventId === "$cause"
        ? {
            ...rootMessage,
            event_id: "$cause",
            sender: room.matrixId,
            content: {
              "m.relates_to": { rel_type: "m.thread", event_id: input.rootId },
            },
          }
        : rootMessage
    );
    mocks.request.mockImplementation(
      async (method, path): ReturnType<typeof matrixRequest> => {
        if (path === "versions")
          return { unstable_features: { "org.matrix.msc4306": true } };
        if (method === "PUT") return {};
        return { automatic };
      }
    );
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
    expect(mocks.joined.mock.calls).toEqual(
      Array.from({ length: 3 }, () => [actor, input.id])
    );
    expect(mocks.message.mock.calls).toEqual(
      automatic
        ? [
            [room, input.rootId, true],
            [room, "$cause", true],
          ]
        : [[room, input.rootId, true]]
    );
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.join).not.toHaveBeenCalled();
    const admission = ["locate", "organization", "room", "locate"];
    expect(admissionOrder).toEqual([
      ...(automatic ? admission : []),
      ...admission,
      "subscription",
      "joined",
      "joined",
      "joined",
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

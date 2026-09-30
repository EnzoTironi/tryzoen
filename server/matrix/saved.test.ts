import { createHash, randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { listSavedMatrixMessages, setSavedMatrixMessage } from "./saved";
import type { matrixRequest } from "./client";
import {
  WorkspaceAccessDenied,
  type requireWorkspaceAccess,
} from "../workspaces/access";
import type {
  joinMatrixRoom,
  requireJoinedMatrixRoom,
  requireMatrixRoom,
} from "./rooms";
import type { ensureMatrixIdentity } from "./identities";
const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  request: vi.fn<typeof matrixRequest>(),
  access: vi.fn<typeof requireWorkspaceAccess>(),
  identity: vi.fn<typeof ensureMatrixIdentity>(),
  joined: vi.fn<typeof requireJoinedMatrixRoom>(),
  join: vi.fn<typeof joinMatrixRoom>(),
  roomAccess: vi.fn<typeof requireMatrixRoom>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: (run: () => Promise<unknown>) => run(),
}));
vi.mock("./rooms", async (original) => ({
  ...(await original<typeof import("./rooms")>()),
  requireJoinedMatrixRoom: mocks.joined,
  joinMatrixRoom: mocks.join,
  requireMatrixRoom: mocks.roomAccess,
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
  mocks.joined.mockReset().mockRejectedValue(new WorkspaceAccessDenied());
  mocks.join.mockReset().mockRejectedValue(new WorkspaceAccessDenied());
  mocks.roomAccess.mockReset();
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

/** The existing-receiver gate is mocked at its room owner. These caller checks
 * do not establish native membership or PostgreSQL concurrency guarantees. */
function mockSavedAdmission() {
  const dialect = new PgDialect();
  mocks.query.mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    if (compiled.sql.includes('w.id AS "workspaceId"'))
      return [{ workspaceId: "space", organizationId: "organization" }];
    if (compiled.sql.includes("FROM organizations"))
      return [{ id: "organization" }];
    if (compiled.sql.includes("pg_advisory_xact_lock")) return [];
    throw new Error("Unexpected SQL outside the saved admission boundary.");
  });
}
const savedActor = {
  userId: "viewer",
  workspaceId: "space",
  authSessionId: "session",
};
const savedPath = "user/%40viewer%3Atest/account_data/org.zoen.saved_messages";
const emptySaved = { version: 1, items: [] };
const emptySavedRevision = createHash("sha256")
  .update(JSON.stringify(emptySaved))
  .digest("hex");

it.each(["pending", "absent native membership"])(
  "denies saving for %s before exact-event reads or publication without joining",
  async () => {
    mockSavedAdmission();
    const id = randomUUID();
    mocks.request.mockResolvedValue(emptySaved);
    await expect(
      setSavedMatrixMessage(savedActor, {
        id,
        messageId: "$event",
        saved: true,
        expectedRevision: emptySavedRevision,
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    expect(mocks.joined).toHaveBeenCalledExactlyOnceWith(savedActor, id);
    expect(mocks.join).not.toHaveBeenCalled();
    expect(mocks.roomAccess).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.identity).not.toHaveBeenCalled();
  }
);

it.each(["group", "direct"] as const)(
  "saves a selected event for an existing %s receiver without joining",
  async (kind) => {
    mockSavedAdmission();
    const id = randomUUID();
    const room = {
      id,
      workspaceId: savedActor.workspaceId,
      roomId: "!room:test",
      epoch: randomUUID(),
      label: "Room",
      kind,
      matrixId: "@receiver:test",
    };
    mocks.joined.mockResolvedValue(room);
    mocks.roomAccess.mockResolvedValue(room);
    mocks.request
      .mockResolvedValueOnce(emptySaved)
      .mockResolvedValueOnce({
        event_id: "$event",
        room_id: room.roomId,
        type: "m.room.message",
        sender: "@sender:test",
        content: { msgtype: "m.text", body: "Selected private content" },
      })
      .mockResolvedValueOnce({})
      .mockImplementationOnce(async () => {
        const published = mocks.request.mock.calls.find(
          ([method]) => method === "PUT"
        )?.[2];
        if (published === undefined)
          throw new Error(
            "Expected the saved collection publication before verification."
          );
        return published;
      });
    const result = await setSavedMatrixMessage(savedActor, {
      id,
      messageId: "$event",
      saved: true,
      expectedRevision: emptySavedRevision,
    });
    expect(result.status).toBe("saved");
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenNthCalledWith(
      1,
      "GET",
      "user/%40receiver%3Atest/account_data/org.zoen.saved_messages",
      undefined,
      room.matrixId,
      { maxResponseBytes: 262144 }
    );
    expect(mocks.joined.mock.calls).toEqual([
      [savedActor, id],
      [savedActor, id],
    ]);
    expect(mocks.join).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenNthCalledWith(
      2,
      "GET",
      "rooms/!room%3Atest/event/%24event",
      undefined,
      room.matrixId
    );
    const published = mocks.request.mock.calls.find(
      ([method]) => method === "PUT"
    )?.[2];
    expect(published).toMatchObject({
      version: 1,
      items: [
        {
          workspaceId: savedActor.workspaceId,
          id,
          roomId: room.roomId,
          eventId: "$event",
        },
      ],
    });
    expect(JSON.stringify(published)).not.toContain("Selected private content");
    expect(published).toHaveProperty("items.0.key");
    expect(published).toHaveProperty("items.0.savedAt");
    expect(mocks.roomAccess).not.toHaveBeenCalled();
  }
);

it.each([false, true])(
  "preserves %s saved-reference metadata semantics and selects the appropriate identity",
  async (saved) => {
    mockSavedAdmission();
    const id = randomUUID();
    const current = {
      version: 1,
      items: [
        {
          key: randomUUID(),
          workspaceId: savedActor.workspaceId,
          id,
          roomId: "!room:test",
          eventId: "$event",
          savedAt: 1,
        },
      ],
    };
    const room = {
      id,
      workspaceId: savedActor.workspaceId,
      roomId: "!room:test",
      epoch: randomUUID(),
      label: "Room",
      kind: "group" as const,
      matrixId: "@viewer:test",
    };
    mocks.joined.mockResolvedValue(room);
    const currentRevision = createHash("sha256")
      .update(JSON.stringify(current))
      .digest("hex");
    mocks.request.mockResolvedValueOnce(current);
    if (!saved)
      mocks.request.mockResolvedValueOnce({}).mockResolvedValueOnce(emptySaved);
    expect(
      await setSavedMatrixMessage(savedActor, {
        id,
        messageId: "$event",
        saved,
        expectedRevision: currentRevision,
      })
    ).toEqual({
      status: "saved",
      revision: saved ? currentRevision : emptySavedRevision,
    });
    expect(mocks.joined.mock.calls).toEqual(saved ? [[savedActor, id]] : []);
    expect(mocks.identity.mock.calls).toEqual(saved ? [] : [[savedActor]]);
    expect(mocks.join).not.toHaveBeenCalled();
    expect(mocks.roomAccess).not.toHaveBeenCalled();
    expect(
      mocks.request.mock.calls.map(([method, path]) => [method, path])
    ).toEqual(
      saved
        ? [["GET", savedPath]]
        : [
            ["GET", savedPath],
            ["PUT", savedPath],
            ["GET", savedPath],
          ]
    );
  }
);

it("withholds saving if the existing receiver becomes unsafe during exact-event hydration", async () => {
  mockSavedAdmission();
  const id = randomUUID();
  const room = {
    id,
    workspaceId: savedActor.workspaceId,
    roomId: "!room:test",
    epoch: randomUUID(),
    label: "Room",
    kind: "group" as const,
    matrixId: "@viewer:test",
  };
  mocks.joined
    .mockResolvedValueOnce(room)
    .mockRejectedValueOnce(new WorkspaceAccessDenied());
  mocks.request.mockResolvedValueOnce(emptySaved).mockResolvedValueOnce({
    event_id: "$event",
    room_id: room.roomId,
    type: "m.room.message",
    sender: "@sender:test",
    content: { body: "Selected private content" },
  });
  await expect(
    setSavedMatrixMessage(savedActor, {
      id,
      messageId: "$event",
      saved: true,
      expectedRevision: emptySavedRevision,
    })
  ).rejects.toThrow(WorkspaceAccessDenied);
  expect(mocks.joined.mock.calls).toEqual([
    [savedActor, id],
    [savedActor, id],
  ]);
  expect(
    mocks.request.mock.calls.map(([method, path]) => [method, path])
  ).toEqual([
    ["GET", savedPath],
    ["GET", "rooms/!room%3Atest/event/%24event"],
  ]);
  expect(mocks.join).not.toHaveBeenCalled();
  expect(mocks.roomAccess).not.toHaveBeenCalled();
  expect(mocks.identity).not.toHaveBeenCalled();
});

it("uses the confirmed receiver identity before checking a conflicting save revision", async () => {
  mockSavedAdmission();
  const id = randomUUID();
  mocks.joined.mockResolvedValue({
    id,
    workspaceId: savedActor.workspaceId,
    roomId: "!room:test",
    epoch: randomUUID(),
    label: "Room",
    kind: "group",
    matrixId: "@receiver:test",
  });
  mocks.request.mockResolvedValue(emptySaved);
  expect(
    await setSavedMatrixMessage(savedActor, {
      id,
      messageId: "$event",
      saved: true,
      expectedRevision: "0".repeat(64),
    })
  ).toEqual({ status: "conflict", revision: emptySavedRevision });
  expect(mocks.joined).toHaveBeenCalledExactlyOnceWith(savedActor, id);
  expect(mocks.request.mock.calls).toEqual([
    [
      "GET",
      "user/%40receiver%3Atest/account_data/org.zoen.saved_messages",
      undefined,
      "@receiver:test",
      { maxResponseBytes: 262144 },
    ],
  ]);
  expect(mocks.identity).not.toHaveBeenCalled();
  expect(mocks.join).not.toHaveBeenCalled();
  expect(mocks.roomAccess).not.toHaveBeenCalled();
});

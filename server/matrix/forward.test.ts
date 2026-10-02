import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { query } from "@db/queries";
import { forwardMatrixMessage, listForwardDestinations } from "./forward";
import { MatrixEventSchema, type matrixRequest } from "./client";
import { WorkspaceAccessDenied } from "../workspaces/access";
import { projectMatrixMessage } from "./messages";

const mocks = vi.hoisted(() => ({
  request: vi.fn<typeof matrixRequest>(),
  access: vi.fn<(id: string) => Promise<void>>(),
  project: vi.fn<() => Promise<void>>(),
  query: vi.fn<typeof query>(),
}));
vi.mock("@db/queries", () => ({
  transaction: (fn: () => Promise<unknown>) => fn(),
  query: mocks.query,
}));
vi.mock("./activity", () => ({ projectMatrixActivity: mocks.project }));
vi.mock("./inbox", () => ({
  authorizedInboxRooms: async () => (await import("drizzle-orm")).sql`SELECT 1`,
}));
vi.mock("./rooms", () => ({
  joinMatrixRoom: async (_actor: unknown, id: string) => {
    await mocks.access(id);
    return { id, roomId: `!${id}:test`, matrixId: "@viewer:test" };
  },
  requireMatrixRoom: (_actor: unknown, id: string) => mocks.access(id),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({ serverName: "test", botId: "@bot:test" }),
}));
const dialect = new PgDialect();
const admissionOrder: string[] = [];
const actor = {
  userId: "viewer",
  workspaceId: "team",
  authSessionId: "session",
};
const input = {
  id: randomUUID(),
  destinationId: randomUUID(),
  messageId: "$source",
  expectedRevision: "$source",
  operationId: randomUUID(),
};
const original = {
  event_id: "$source",
  room_id: `!${input.id}:test`,
  type: "m.room.message",
  sender: "@author:test",
  content: {
    msgtype: "m.text",
    body: "> <@private:test> Private quote\n\n**Shared text**",
    "m.mentions": { user_ids: ["@bot:test", "@private:test"] },
    "m.relates_to": {
      rel_type: "m.thread",
      event_id: "$root",
      "m.in_reply_to": { event_id: "$private" },
    },
  },
};
let source = MatrixEventSchema.parse(original);
let published = MatrixEventSchema.parse({
  ...original,
  event_id: "$copy",
  room_id: `!${input.destinationId}:test`,
  sender: "@viewer:test",
  content: {},
});
function admissionRows(statement: Parameters<typeof query>[0]) {
  const { sql: raw, params } = dialect.sqlToQuery(statement);
  const text = raw.replace(/\s+/gu, " ").trim();
  if (text.startsWith('SELECT w.id AS "workspaceId"')) {
    expect(params).toEqual([
      actor.workspaceId,
      ...[input.id, input.destinationId].toSorted(),
    ]);
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
    const id = params[0];
    if (typeof id !== "string")
      throw new Error("A room fence must have a binding ID.");
    admissionOrder.push(`room:${id}`);
    return [];
  }
  if (text.startsWith("SELECT pg_advisory_xact_lock") && text.includes(", 10)"))
    return [];
  throw new Error(`Unexpected forward admission SQL: ${text}`);
}
beforeEach(() => {
  source = MatrixEventSchema.parse(original);
  mocks.access.mockReset().mockResolvedValue(undefined);
  mocks.project.mockReset().mockResolvedValue(undefined);
  admissionOrder.length = 0;
  mocks.query
    .mockReset()
    .mockImplementation(async (statement) => admissionRows(statement));
  mocks.request.mockReset().mockImplementation(async (method, path, body) => {
    if (method === "PUT") {
      published = MatrixEventSchema.parse({
        ...original,
        event_id: "$copy",
        room_id: `!${input.destinationId}:test`,
        sender: "@viewer:test",
        content: body,
      });
      return { event_id: "$copy" };
    }
    return path.endsWith("%24source") ? source : published;
  });
});
it("forwards a standalone copy without leaking the quoted author or original thread", async () => {
  expect(await forwardMatrixMessage(actor, input)).toEqual({
    status: "sent",
    messageId: "$copy",
  });
  expect(published.content).toEqual({
    msgtype: "m.text",
    body: "**Shared text**",
    "org.zoen.forwarded": true,
  });
  expect(
    projectMatrixMessage(published, [], "@viewer:test", "@bot:test")
  ).toMatchObject({ forwarded: true, mine: true, reply: null, rootId: null });
  expect(mocks.project).toHaveBeenCalledWith("test", published);
  await forwardMatrixMessage(actor, input);
  expect(
    mocks.request.mock.calls
      .filter(([method]) => method === "PUT")
      .map(([, path]) => path)
  ).toEqual([
    `rooms/!${input.destinationId}%3Atest/send/m.room.message/zoen_forward_${input.operationId}`,
    `rooms/!${input.destinationId}%3Atest/send/m.room.message/zoen_forward_${input.operationId}`,
  ]);
});
it.each(["m.image", "m.video", "m.audio", "m.file"])(
  "preserves %s metadata without copying private relations",
  async (msgtype) => {
    source = MatrixEventSchema.parse({
      ...original,
      content: {
        ...original.content,
        msgtype,
        body: "clip.bin",
        filename: "clip.bin",
        url: "mxc://test/resource",
        info: { mimetype: "application/octet-stream", size: 20 },
      },
    });
    await forwardMatrixMessage(actor, input);
    expect(published.content).toEqual({
      msgtype,
      body: "clip.bin",
      filename: "clip.bin",
      url: "mxc://test/resource",
      info: { mimetype: "application/octet-stream", size: 20 },
      "org.zoen.forwarded": true,
    });
  }
);
it("requires review again when the source revision changes", async () => {
  source = MatrixEventSchema.parse({
    ...original,
    unsigned: {
      "m.relations": {
        "m.replace": {
          event_id: "$edit",
          type: "m.room.message",
          sender: original.sender,
          content: {
            msgtype: "m.text",
            body: "* New",
            "m.new_content": { msgtype: "m.text", body: "New" },
            "m.relates_to": { rel_type: "m.replace", event_id: "$source" },
          },
        },
      },
    },
  });
  expect(await forwardMatrixMessage(actor, input)).toMatchObject({
    status: "changed",
    message: { text: "New", editId: "$edit" },
  });
  expect(mocks.request.mock.calls.some(([method]) => method === "PUT")).toBe(
    false
  );
  await forwardMatrixMessage(actor, { ...input, expectedRevision: "$edit" });
  expect(published.content.body).toBe("New");
});
it.each([
  { ...original, room_id: "!wrong:test" },
  { ...original, event_id: "$wrong" },
  { ...original, state_key: "" },
  { ...original, unsigned: { redacted_because: {} } },
  {
    ...original,
    content: {
      msgtype: "m.image",
      body: "External",
      url: "https://private.invalid",
    },
  },
])("rejects an invalid, removed or unsupported source", async (event) => {
  source = MatrixEventSchema.parse(event);
  await expect(forwardMatrixMessage(actor, input)).rejects.toThrow(Error);
  expect(mocks.request.mock.calls.some(([method]) => method === "PUT")).toBe(
    false
  );
});
it.each([input.id, input.destinationId])(
  "rechecks current authority for %s before publication",
  async (id) => {
    mocks.access.mockImplementation(async (candidate) => {
      if (candidate === id && mocks.request.mock.calls.length > 0)
        throw new WorkspaceAccessDenied();
    });
    await expect(forwardMatrixMessage(actor, input)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(mocks.request.mock.calls.some(([method]) => method === "PUT")).toBe(
      false
    );
  }
);
it("does not acknowledge a native transaction replay with a different payload", async () => {
  mocks.request.mockImplementation(async (method, path) => {
    if (method === "PUT") return { event_id: "$copy" };
    return path.endsWith("%24source")
      ? source
      : {
          ...published,
          content: {
            msgtype: "m.text",
            body: "Another copy",
            "org.zoen.forwarded": true,
          },
        };
  });
  await expect(forwardMatrixMessage(actor, input)).rejects.toMatchObject({
    reason: "conflict",
  });
  expect(mocks.project).not.toHaveBeenCalled();
});
it("cannot enumerate destinations when source access has been revoked", async () => {
  mocks.access.mockRejectedValue(new WorkspaceAccessDenied());
  await expect(
    listForwardDestinations(actor, { id: input.id, query: "" })
  ).rejects.toThrow(WorkspaceAccessDenied);
  expect(mocks.query).not.toHaveBeenCalled();
});

it.each(["source-first", "destination-first"])(
  "acquires the complete sorted room set before the first join for %s forwarding",
  async (direction) => {
    const opposed =
      direction === "source-first"
        ? input
        : { ...input, id: input.destinationId, destinationId: input.id };
    mocks.access.mockImplementation(async (id) => {
      admissionOrder.push(`join:${id}`);
      throw new WorkspaceAccessDenied();
    });
    await expect(forwardMatrixMessage(actor, opposed)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(admissionOrder).toEqual([
      "locate",
      "organization",
      ...[input.id, input.destinationId].toSorted().map((id) => `room:${id}`),
      "locate",
      `join:${opposed.id}`,
    ]);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
  }
);

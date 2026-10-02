import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { MatrixEventSchema, type matrixRequest } from "./client";
import { sendMatrixMessage } from "./send";
import { editMatrixMessage } from "./edits";
import type { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import type { requireWorkspaceAccess } from "../workspaces/access";
import type { uploadMatrixMedia } from "./media/upload";

const mocks = vi.hoisted(() => ({
  request: vi.fn<typeof matrixRequest>(),
  join: vi.fn<typeof joinMatrixRoom>(),
  roomAccess: vi.fn<typeof requireMatrixRoom>(),
  access: vi.fn<typeof requireWorkspaceAccess>(),
  upload: vi.fn<typeof uploadMatrixMedia>(),
}));
vi.mock("@db/queries", () => ({
  query: async () => [],
  transaction: (run: () => Promise<unknown>) => run(),
}));
vi.mock("./rooms", () => ({
  joinMatrixRoom: mocks.join,
  requireMatrixRoom: mocks.roomAccess,
}));
vi.mock("../workspaces/access", async (original) => ({
  ...(await original<typeof import("../workspaces/access")>()),
  requireWorkspaceAccess: mocks.access,
}));
vi.mock("./activity", () => ({ projectMatrixActivity: async () => undefined }));
vi.mock("./media/upload", () => ({ uploadMatrixMedia: mocks.upload }));
vi.mock("./thread-subscriptions", () => ({
  setThreadSubscription: async () => ({
    status: "ready",
    following: true,
    automatic: true,
  }),
}));
vi.mock("./direct", () => ({ directRoomMembers: async () => [] }));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({ serverName: "test", botId: "@bot:test" }),
}));

const actor = {
  userId: "better-auth:author",
  workspaceId: "workspace",
  authSessionId: "session",
};
const room = {
  id: randomUUID(),
  workspaceId: "workspace",
  roomId: "!group:test",
  label: "Synthetic",
  epoch: "epoch",
  kind: "group" as const,
  matrixId: "@author:test",
};
const base = {
  event_id: "$original",
  room_id: room.roomId,
  type: "m.room.message",
  sender: room.matrixId,
  content: {
    msgtype: "m.text",
    body: "@Zoen original",
    "m.mentions": { user_ids: ["@bot:test"] },
  },
};
let source = MatrixEventSchema.parse(base);
let sent = MatrixEventSchema.parse({ ...base, event_id: "$sent" });
beforeEach(() => {
  source = MatrixEventSchema.parse(base);
  mocks.join.mockReset().mockResolvedValue(room);
  mocks.roomAccess.mockReset().mockResolvedValue(room);
  mocks.access
    .mockReset()
    .mockResolvedValue({ ...actor, role: "member", organizationId: "org" });
  mocks.upload.mockReset().mockResolvedValue({
    url: "mxc://test/file",
    info: { mimetype: "text/plain", size: 4 },
  });
  mocks.request
    .mockReset()
    .mockImplementation(async (method, path, content) => {
      if (method === "PUT") {
        sent = MatrixEventSchema.parse({ ...base, event_id: "$sent", content });
        if (sent.content["m.relates_to"]?.rel_type === "m.replace")
          source = MatrixEventSchema.parse({
            ...source,
            unsigned: { "m.relations": { "m.replace": sent } },
          });
        return { event_id: sent.event_id };
      }
      return path.endsWith("%24sent") ? sent : source;
    });
});
it.each([
  "Ready",
  "> @Zoen quoted\n\nReady",
  String.raw`\@Zoen`,
  "https://example.invalid/?assignee=@zoen",
])(
  "keeps a reply quote from activating Zoen when authored text is %s",
  async (text) => {
    await sendMatrixMessage(actor, {
      id: room.id,
      operationId: randomUUID(),
      text,
      replyTo: source.event_id,
    });
    expect(sent.content.body).toContain("> <@author:test> @Zoen original");
    expect(sent.content["m.mentions"]).toEqual({ user_ids: [] });
  }
);
it("mentions from the authored reply only and preserves native retry IDs", async () => {
  const input = {
    id: room.id,
    operationId: randomUUID(),
    text: "@Zoen follow up",
    replyTo: source.event_id,
  };
  expect(await sendMatrixMessage(actor, input)).toEqual({ event_id: "$sent" });
  expect(await sendMatrixMessage(actor, input)).toEqual({ event_id: "$sent" });
  const sends = mocks.request.mock.calls.filter(([method]) => method === "PUT");
  expect(sends).toHaveLength(2);
  expect(sends[0]?.[1]).toBe(sends[1]?.[1]);
  expect(sends[0]?.[2]).toEqual(sends[1]?.[2]);
  expect(sent.content["m.mentions"]).toEqual({ user_ids: ["@bot:test"] });
});
it("keeps attachment filenames silent even beside an authored mention", async () => {
  await sendMatrixMessage(actor, {
    id: room.id,
    operationId: randomUUID(),
    text: "@Zoen inspect",
    files: [
      {
        type: "file",
        filename: "@Zoen.txt",
        mediaType: "text/plain",
        url: "data:text/plain;base64,dGVzdA==",
      },
    ],
  });
  expect(
    mocks.request.mock.calls
      .filter(([method]) => method === "PUT")
      .map(
        ([, , content]) =>
          MatrixEventSchema.shape.content.parse(content)["m.mentions"]
      )
  ).toEqual([{ user_ids: ["@bot:test"] }, { user_ids: [] }]);
});
it("rechecks room authorization before publishing", async () => {
  mocks.join.mockRejectedValue(new Error("Room revoked"));
  await expect(
    sendMatrixMessage(actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "@Zoen",
    })
  ).rejects.toThrow("Room revoked");
  expect(mocks.request).not.toHaveBeenCalled();
});
it.each([
  [[], "@Zoen newly mentioned", ["@bot:test"], ["@bot:test"]],
  [["@bot:test"], "@Zoen still mentioned", [], ["@bot:test"]],
  [["@bot:test"], "Mention removed", [], []],
  [["@bot:test"], String.raw`\@Zoen escaped`, [], []],
])(
  "publishes final edit mentions and only the notification delta",
  async (previous, text, delta, final) => {
    source = MatrixEventSchema.parse({
      ...base,
      content: { ...base.content, "m.mentions": { user_ids: previous } },
    });
    await editMatrixMessage(actor, {
      id: room.id,
      messageId: source.event_id,
      expectedRevision: source.event_id,
      operationId: randomUUID(),
      text,
    });
    expect(sent.content["m.mentions"]).toEqual({ user_ids: delta });
    expect(sent.content["m.new_content"]?.["m.mentions"]).toEqual({
      user_ids: final,
    });
    expect(sent.content["m.relates_to"]).toEqual({
      rel_type: "m.replace",
      event_id: "$original",
    });
  }
);
it("compares edit mentions to the latest revision and replays the same edit once", async () => {
  source = MatrixEventSchema.parse({
    ...base,
    unsigned: {
      "m.relations": {
        "m.replace": {
          ...base,
          event_id: "$previous",
          content: {
            msgtype: "m.text",
            body: "* Removed",
            "m.new_content": {
              msgtype: "m.text",
              body: "Removed",
              "m.mentions": { user_ids: [] },
            },
            "m.relates_to": { rel_type: "m.replace", event_id: "$original" },
          },
        },
      },
    },
  });
  const input = {
    id: room.id,
    messageId: source.event_id,
    expectedRevision: "$previous",
    operationId: randomUUID(),
    text: "@Zoen added again",
  };
  expect((await editMatrixMessage(actor, input)).status).toBe("saved");
  expect(sent.content["m.mentions"]).toEqual({ user_ids: ["@bot:test"] });
  expect((await editMatrixMessage(actor, input)).status).toBe("saved");
  expect(
    mocks.request.mock.calls.filter(([method]) => method === "PUT")
  ).toHaveLength(1);
});

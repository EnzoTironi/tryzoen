import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { deleteMatrixMessage } from "./message-actions";
import { projectMatrixMessage, readRoomMessage } from "./messages";
import { WorkspaceAccessDenied } from "../workspaces/access";
import { MatrixEventSchema, type matrixRequest } from "./client";

const mocks = vi.hoisted(() => ({
  request: vi.fn<typeof matrixRequest>(),
  access: vi.fn<() => Promise<void>>(),
}));
vi.mock("@db/queries", () => ({
  transaction: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("./rooms", () => ({
  joinMatrixRoom: async () => {
    await mocks.access();
    return { roomId: "!room:test", matrixId: "@person:test" };
  },
  requireMatrixRoom: mocks.access,
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
}));
const actor = {
  userId: "person",
  workspaceId: "team",
  authSessionId: "session",
};
const input = {
  id: randomUUID(),
  messageId: "$message",
  operationId: randomUUID(),
};
const message = {
  event_id: "$message",
  room_id: "!room:test",
  type: "m.room.message",
  sender: "@person:test",
  content: { body: "Private text", msgtype: "m.text" },
};
beforeEach(() => {
  mocks.access.mockReset().mockResolvedValue(undefined);
  mocks.request
    .mockReset()
    .mockImplementation(async (method) =>
      method === "GET" ? message : { event_id: "$redaction" }
    );
});
it("redacts only the authenticated sender using a stable native transaction ID", async () => {
  await deleteMatrixMessage(actor, input);
  await deleteMatrixMessage(actor, input);
  expect(
    mocks.request.mock.calls.filter(([method]) => method === "PUT")
  ).toEqual([
    [
      "PUT",
      `rooms/!room%3Atest/redact/%24message/${input.operationId}`,
      {},
      "@person:test",
    ],
    [
      "PUT",
      `rooms/!room%3Atest/redact/%24message/${input.operationId}`,
      {},
      "@person:test",
    ],
  ]);
});
it.each([
  { ...message, sender: "@someone:test" },
  { ...message, room_id: "!other:test" },
  { ...message, event_id: "$other" },
  { ...message, type: "m.room.member" },
])("rejects other senders, rooms and mismatched events", async (event) => {
  mocks.request.mockResolvedValue(event);
  await expect(deleteMatrixMessage(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(mocks.request.mock.calls.every(([method]) => method === "GET")).toBe(
    true
  );
});
it("rechecks current membership before publishing a redaction", async () => {
  mocks.access
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(deleteMatrixMessage(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("can retry a successful redaction whose response was lost", async () => {
  mocks.request.mockResolvedValueOnce({
    ...message,
    content: {},
    unsigned: { redacted_because: { event_id: "$redaction" } },
  });
  await deleteMatrixMessage(actor, input);
  expect(mocks.request).toHaveBeenLastCalledWith(
    "PUT",
    `rooms/!room%3Atest/redact/%24message/${input.operationId}`,
    {},
    "@person:test"
  );
});
it("never projects redacted text, quote or media even if stale content is included", () => {
  const event = MatrixEventSchema.parse({
    ...message,
    unsigned: { redacted_because: {} },
    content: {
      body: "secret.jpg",
      filename: "secret.jpg",
      url: "mxc://test/private",
      msgtype: "m.image",
    },
  });
  expect(
    projectMatrixMessage(event, [], "@person:test", "@bot:test")
  ).toMatchObject({ text: "Mensagem removida", redacted: true, reply: null });
  expect(
    projectMatrixMessage(event, [], "@person:test", "@bot:test")
  ).not.toHaveProperty("media");
});
it("keeps a redacted root readable for thread navigation but denies content consumers", async () => {
  mocks.request.mockResolvedValue({
    ...message,
    content: {},
    unsigned: { redacted_because: {} },
  });
  const room: Parameters<typeof readRoomMessage>[0] = {
    id: input.id,
    label: "Synthetic",
    workspaceId: "workspace",
    epoch: input.id,
    kind: "group",
    roomId: "!room:test",
    matrixId: "@person:test",
  };
  await expect(readRoomMessage(room, "$message", true)).resolves.toMatchObject({
    event_id: "$message",
    content: {},
  });
  await expect(readRoomMessage(room, "$message")).rejects.toThrow(
    WorkspaceAccessDenied
  );
});

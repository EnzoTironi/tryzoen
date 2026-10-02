import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attachmentLimits } from "@zoen/companion-ui/messages";
import type { downloadMediaBytes } from "../../channels/media/download";
import type { joinMatrixRoom } from "../rooms";
import type { readRoomMessage } from "../messages";
import {
  WorkspaceAccessDenied,
  type requireWorkspaceAccess,
} from "../../workspaces/access";
import { readMatrixMedia } from "./read";

const mocks = vi.hoisted(() => ({
  download: vi.fn<typeof downloadMediaBytes>(),
  join: vi.fn<typeof joinMatrixRoom>(),
  message: vi.fn<typeof readRoomMessage>(),
  access: vi.fn<typeof requireWorkspaceAccess>(),
}));
vi.mock("@db/queries", () => ({
  query: () => {
    throw new Error("Database access is outside this media unit test");
  },
}));
vi.mock("../client", () => ({
  matrixConfiguration: async () => ({
    url: "https://matrix.invalid",
    token: { reveal: () => "synthetic" },
  }),
}));
vi.mock("../../channels/media/download", () => ({
  downloadMediaBytes: mocks.download,
}));
vi.mock("../rooms", () => ({ joinMatrixRoom: mocks.join }));
vi.mock("../messages", () => ({ readRoomMessage: mocks.message }));
vi.mock("../../workspaces/access", async (original) => ({
  ...(await original<typeof import("../../workspaces/access")>()),
  requireWorkspaceAccess: mocks.access,
}));

const actor = {
  userId: "viewer",
  workspaceId: "workspace",
  authSessionId: "session",
};
const input = {
  id: "547cfef0-4797-4aca-8510-d6e30f9802fd",
  messageId: "$media",
};
const room = {
  id: input.id,
  workspaceId: actor.workspaceId,
  roomId: "!room:matrix.invalid",
  label: "Synthetic room",
  epoch: "1",
  kind: "group" as const,
  matrixId: "@viewer:matrix.invalid",
};

beforeEach(() => {
  mocks.download.mockReset().mockResolvedValue(Buffer.from([0, 255, 128]));
  mocks.join.mockReset().mockResolvedValue(room);
  mocks.message.mockReset().mockResolvedValue({
    event_id: input.messageId,
    room_id: room.roomId,
    type: "m.room.message",
    sender: "@sender:matrix.invalid",
    content: {
      msgtype: "m.file",
      body: "bytes.bin",
      filename: "bytes.bin",
      url: "mxc://matrix.invalid/content",
      info: { mimetype: "application/octet-stream" },
    },
  });
  mocks.access.mockReset().mockResolvedValue({
    ...actor,
    role: "member",
    organizationId: "organization",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

it("encodes only the downloaded byte range without another Buffer or retaining binary output", async () => {
  const backing = Buffer.alloc(65_536, 0x7e);
  const bytes = backing.subarray(123, 132);
  bytes.set([0, 255, 128, 10, 47, 195, 169, 61, 0]);
  mocks.download.mockResolvedValue(bytes);
  const expected = {
    type: "file",
    filename: "bytes.bin",
    mediaType: "application/octet-stream",
    url: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
  };
  const bufferFrom = vi.spyOn(Buffer, "from");

  const result = await readMatrixMedia(actor, input);

  expect(result).toStrictEqual(expected);
  expect(
    bufferFrom.mock.calls.filter(
      ([value]) => Object.is(value, bytes) || Object.is(value, bytes.buffer)
    )
  ).toEqual([]);
  // The returned attachment has only strings, and no live view of the larger buffer.
  backing.fill(0);
  expect(result).toStrictEqual(expected);
  expect(mocks.download).toHaveBeenCalledExactlyOnceWith(
    "https://matrix.invalid/_matrix/client/v1/media/download/matrix.invalid/content?user_id=%40viewer%3Amatrix.invalid",
    attachmentLimits.bytes,
    { headers: { authorization: "Bearer synthetic" } }
  );
  expect(mocks.access).toHaveBeenCalledExactlyOnceWith(actor);
  expect(mocks.join.mock.calls).toEqual([
    [actor, input.id],
    [actor, input.id],
  ]);
});

it("does not encode or return bytes when workspace access is revoked after download", async () => {
  const bytes = Buffer.from([0, 255, 128]);
  mocks.download.mockResolvedValue(bytes);
  mocks.access.mockRejectedValue(new WorkspaceAccessDenied());
  const encode = vi.spyOn(bytes, "toString");

  await expect(readMatrixMedia(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );

  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.access).toHaveBeenCalledExactlyOnceWith(actor);
  expect(mocks.join).toHaveBeenCalledTimes(1);
  expect(encode).not.toHaveBeenCalled();
});

it("does not encode or return bytes when room access is revoked on the final check", async () => {
  const bytes = Buffer.from([0, 255, 128]);
  mocks.download.mockResolvedValue(bytes);
  mocks.join
    .mockReset()
    .mockResolvedValueOnce(room)
    .mockRejectedValueOnce(new WorkspaceAccessDenied());
  const encode = vi.spyOn(bytes, "toString");

  await expect(readMatrixMedia(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );

  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.access).toHaveBeenCalledExactlyOnceWith(actor);
  expect(mocks.join.mock.calls).toEqual([
    [actor, input.id],
    [actor, input.id],
  ]);
  expect(encode).not.toHaveBeenCalled();
});

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { roomSchema } from "@zoen/companion-ui/rooms";
import { MatrixError, MatrixRateLimitError } from "../client";
import { WorkspaceAccessDenied } from "../../workspaces/access";
import type { joinMatrixRoom, requireMatrixRoom } from "../rooms";
import type { readRoomMembers } from "../members";
import type { updateMatrixPresence } from "../presence";
import type { pollNativeSync } from "./native";
import { readMatrixRoomSync } from "./room";
import { openRoomSyncCursor } from "./room-cursor";

const mocks = vi.hoisted(() => ({
  join: vi.fn<typeof joinMatrixRoom>(),
  require: vi.fn<typeof requireMatrixRoom>(),
  members: vi.fn<typeof readRoomMembers>(),
  presence: vi.fn<typeof updateMatrixPresence>(),
  native: vi.fn<typeof pollNativeSync>(),
}));
vi.mock("../rooms", () => ({
  joinMatrixRoom: mocks.join,
  requireMatrixRoom: mocks.require,
}));
vi.mock("../members", () => ({ readRoomMembers: mocks.members }));
vi.mock("../presence", () => ({ updateMatrixPresence: mocks.presence }));
vi.mock("./native", () => ({ pollNativeSync: mocks.native }));
vi.mock("@db/services/auth", () => ({
  getAuth: async () => ({
    $context: Promise.resolve({
      secretConfig: "synthetic-room-sync-key-long-enough",
    }),
  }),
}));

const actor = {
  userId: "viewer",
  workspaceId: "workspace",
  authSessionId: "session",
};
const room = roomSchema.parse({
  id: randomUUID(),
  roomId: "!room:test",
  workspaceId: actor.workspaceId,
  epoch: "epoch",
  label: "Synthetic room",
  kind: "group",
});
const now = 1_791_116_400_000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.join
    .mockReset()
    .mockResolvedValue({ ...room, matrixId: "@viewer:test" });
  mocks.require.mockReset().mockResolvedValue(room);
  mocks.members.mockReset().mockResolvedValue([]);
  mocks.presence.mockReset().mockResolvedValue({ sharing: true });
  mocks.native.mockReset().mockResolvedValue({ next_batch: "next" });
});
afterEach(() => vi.useRealTimers());

it("keeps native sync ready during presence throttling and waits before retrying", async () => {
  mocks.presence.mockRejectedValueOnce(
    new MatrixRateLimitError({ retryAfterMs: 17000 })
  );
  const first = await readMatrixRoomSync(actor, { id: room.id });
  expect(first.status).toBe("ready");
  expect(first.cursor).not.toBeNull();
  expect(
    await openRoomSyncCursor(actor, first.cursor ?? undefined)
  ).toMatchObject({
    presencePublishedAt: 0,
    presenceRetryAt: now + 17000,
  });
  vi.setSystemTime(now + 16000);
  const second = await readMatrixRoomSync(actor, {
    id: room.id,
    cursor: first.cursor ?? undefined,
  });
  expect(second.status).toBe("ready");
  expect(mocks.presence).toHaveBeenCalledTimes(1);
  vi.setSystemTime(now + 18000);
  const recovered = await readMatrixRoomSync(actor, {
    id: room.id,
    cursor: second.cursor ?? undefined,
  });
  expect(recovered.status).toBe("ready");
  expect(mocks.presence).toHaveBeenCalledTimes(2);
  expect(
    await openRoomSyncCursor(actor, recovered.cursor ?? undefined)
  ).toMatchObject({
    presencePublishedAt: now + 18000,
    presenceRetryAt: 0,
  });
  expect(mocks.native).toHaveBeenCalledTimes(3);
});

it.each(["forbidden", "unavailable"] as const)(
  "keeps %s presence failures visible",
  async (reason) => {
    mocks.presence.mockRejectedValue(new MatrixError({ reason }));
    expect(await readMatrixRoomSync(actor, { id: room.id })).toMatchObject({
      status: "unavailable",
      cursor: null,
    });
    expect(mocks.native).not.toHaveBeenCalled();
  }
);

it("does not suppress native timeline rate limits or unexpected failures", async () => {
  mocks.native.mockRejectedValue(
    new MatrixRateLimitError({ retryAfterMs: 60000 })
  );
  expect(await readMatrixRoomSync(actor, { id: room.id })).toMatchObject({
    status: "unavailable",
    cursor: null,
  });
  mocks.presence.mockRejectedValue(new Error("Unexpected database failure"));
  await expect(readMatrixRoomSync(actor, { id: room.id })).rejects.toThrow(
    "Unexpected database failure"
  );
});

it("denies a revoked reader even when the optional presence call was throttled", async () => {
  mocks.presence.mockRejectedValue(
    new MatrixRateLimitError({ retryAfterMs: 60000 })
  );
  mocks.require.mockRejectedValue(new WorkspaceAccessDenied());
  expect(await readMatrixRoomSync(actor, { id: room.id })).toMatchObject({
    status: "denied",
    cursor: null,
    changes: null,
    presence: [],
    receipts: [],
  });
  expect(mocks.native).toHaveBeenCalledTimes(1);
});

it("keeps the presence cooldown bound to its authenticated session and room", async () => {
  mocks.presence.mockRejectedValue(
    new MatrixRateLimitError({ retryAfterMs: 60000 })
  );
  const first = await readMatrixRoomSync(actor, { id: room.id });
  await expect(
    readMatrixRoomSync(
      { ...actor, authSessionId: "other" },
      {
        id: room.id,
        cursor: first.cursor ?? undefined,
      }
    )
  ).rejects.toThrow(WorkspaceAccessDenied);
  mocks.join.mockResolvedValue({
    ...room,
    roomId: "!other:test",
    matrixId: "@viewer:test",
  });
  await expect(
    readMatrixRoomSync(actor, {
      id: room.id,
      cursor: first.cursor ?? undefined,
    })
  ).rejects.toThrow(WorkspaceAccessDenied);
  expect(mocks.native).toHaveBeenCalledTimes(1);
});

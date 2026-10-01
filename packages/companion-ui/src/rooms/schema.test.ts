import { expect, it } from "vitest";
import { roomPageSchema, roomParticipationSchema, roomSchema } from "./schema";

const room = roomSchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "workspace",
  roomId: "!room:test",
  label: "Synthetic room",
  epoch: "00000000-0000-4000-8000-000000000002",
  kind: "group",
});

it("exposes a confirmed room only in the joined participation envelope", () => {
  expect(roomParticipationSchema.parse({ status: "joined", room })).toEqual({
    status: "joined",
    room,
  });
  expect(
    roomParticipationSchema.parse({
      status: "joined",
      room: { ...room, matrixId: "@viewer:test" },
    })
  ).toEqual({ status: "joined", room });
  expect(
    roomParticipationSchema.safeParse({
      status: "joined",
      room,
      matrixId: "@viewer:test",
    }).success
  ).toBe(false);
});

it.each([100, 30000])(
  "accepts a pending participation retry of %i milliseconds without native state",
  (retryAfterMs) => {
    const pending = { status: "pending", id: room.id, retryAfterMs };
    expect(roomParticipationSchema.parse(pending)).toEqual(pending);
  }
);

it.each([0, 99, 30001, -1, 100.5, Number.POSITIVE_INFINITY, Number.NaN])(
  "rejects an invalid participation retry of %s",
  (retryAfterMs) => {
    expect(
      roomParticipationSchema.safeParse({
        status: "pending",
        id: room.id,
        retryAfterMs,
      }).success
    ).toBe(false);
  }
);

it.each([
  { room },
  { roomId: room.roomId },
  { matrixId: "@viewer:test" },
  { history: [] },
  { identity: { matrixId: "@viewer:test" } },
])(
  "rejects native or history fields in a pending participation envelope: %j",
  (extra) => {
    expect(
      roomParticipationSchema.safeParse({
        status: "pending",
        id: room.id,
        retryAfterMs: 1000,
        ...extra,
      }).success
    ).toBe(false);
  }
);

it.each(["denied", "unavailable", "unsupported"])(
  "does not represent %s as pending participation",
  (status) => {
    expect(
      roomParticipationSchema.safeParse({
        status,
        id: room.id,
        retryAfterMs: 1000,
      }).success
    ).toBe(false);
  }
);

it("keeps successful history pages in their existing shape", () => {
  const page = {
    room,
    members: [],
    membersTruncated: false,
    messages: [],
    nextCursor: null,
  };
  expect(roomPageSchema.parse(page)).toEqual(page);
  expect(
    roomPageSchema.safeParse({
      status: "pending",
      id: room.id,
      retryAfterMs: 1000,
    }).success
  ).toBe(false);
});

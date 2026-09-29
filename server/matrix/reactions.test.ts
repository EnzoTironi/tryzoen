import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import {
  readMatrixReactions,
  setMatrixReaction,
  readMatrixReactors,
} from "./reactions";
import type { matrixRequest } from "./client";
const mocks = vi.hoisted(() => ({
  request: vi.fn<typeof matrixRequest>(),
  access: vi.fn<() => Promise<void>>(),
  members: vi.fn<typeof import("./members").readRoomMembers>(),
}));
vi.mock("@db/queries", () => ({
  transaction: (fn: () => Promise<unknown>) => fn(),
  query: async () => [],
}));
vi.mock("./members", () => ({ readRoomMembers: mocks.members }));
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
  matrixConfiguration: async () => ({ botId: "@bot:test" }),
}));
const actor = {
  userId: "person",
  workspaceId: "team",
  authSessionId: "session",
};
const id = randomUUID();
const reaction = {
  event_id: "$reaction",
  type: "m.reaction",
  sender: "@person:test",
  content: {
    "m.relates_to": {
      rel_type: "m.annotation",
      event_id: "$message",
      key: "❤️",
    },
  },
};
beforeEach(() => {
  mocks.access.mockReset().mockResolvedValue(undefined);
  mocks.request.mockReset();
  mocks.members.mockReset().mockResolvedValue([
    {
      id: "@person:test",
      name: "Ana",
      mine: true,
      bot: false,
      username: "ana",
    },
  ]);
});
it("counts distinct senders and ignores redacted and unrelated annotations", async () => {
  mocks.request.mockResolvedValue({
    chunk: [
      reaction,
      { ...reaction, event_id: "$duplicate" },
      { ...reaction, event_id: "$other", sender: "@other:test" },
      { ...reaction, content: {} },
    ],
  });
  expect(
    await readMatrixReactions(actor, {
      id,
      messageIds: ["$message", "$message"],
    })
  ).toEqual([
    {
      messageId: "$message",
      mine: "❤️",
      mineEventId: "$reaction",
      reactions: [{ emoji: "❤️", count: 2 }],
      complete: true,
    },
  ]);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("discloses truncated reaction counts and bounds visible reads", async () => {
  mocks.request.mockResolvedValue({ chunk: [reaction], next_batch: "more" });
  expect(
    (await readMatrixReactions(actor, { id, messageIds: ["$message"] }))[0]
      ?.complete
  ).toBe(false);
  await expect(
    readMatrixReactions(actor, {
      id,
      messageIds: Array.from({ length: 13 }, (_, i) => `$${i}`),
    })
  ).rejects.toThrow(ZodError);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("rechecks authorization after reading and never releases stale counts", async () => {
  mocks.request.mockResolvedValue({ chunk: [reaction] });
  mocks.access
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("revoked"));
  await expect(
    readMatrixReactions(actor, { id, messageIds: ["$message"] })
  ).rejects.toThrow("revoked");
});
it("only redacts the viewer's selected previous reaction, preserving other participants", async () => {
  const operationId = randomUUID();
  mocks.request.mockImplementation(
    async (method, path): ReturnType<typeof matrixRequest> => {
      if (path.includes("/event/"))
        return {
          event_id: "$message",
          sender: "@person:test",
          type: "m.room.message",
          content: { body: "Hello" },
        };
      if (method === "GET")
        return {
          chunk: [
            reaction,
            { ...reaction, event_id: "$foreign", sender: "@other:test" },
            {
              ...reaction,
              event_id: "$newer",
              content: {
                "m.relates_to": {
                  ...reaction.content["m.relates_to"],
                  key: "👍",
                },
              },
            },
          ],
        };
      return { event_id: "$saved" };
    }
  );
  await setMatrixReaction(actor, {
    id,
    messageId: "$message",
    operationId,
    previousEventId: "$reaction",
    emoji: "🎉",
  });
  const redactions = mocks.request.mock.calls.filter(([, path]) =>
    path.includes("/redact/")
  );
  expect(redactions).toHaveLength(1);
  expect(redactions[0]?.[1]).toContain("/redact/%24reaction/");
  expect(mocks.request).toHaveBeenCalledWith(
    "PUT",
    `rooms/!room%3Atest/send/m.reaction/${operationId}`,
    {
      "m.relates_to": {
        rel_type: "m.annotation",
        event_id: "$message",
        key: "🎉",
      },
    },
    "@person:test"
  );
});

it("returns a bounded native reactor page with current member attribution and deduplication", async () => {
  mocks.request
    .mockResolvedValueOnce({
      event_id: "$message",
      type: "m.room.message",
      sender: "@person:test",
      content: { body: "Hello" },
    })
    .mockResolvedValueOnce({
      chunk: [
        reaction,
        { ...reaction, event_id: "$duplicate" },
        {
          ...reaction,
          event_id: "$removed",
          unsigned: { redacted_because: {} },
        },
      ],
      next_batch: "native-next",
    });
  expect(
    await readMatrixReactors(actor, {
      id,
      messageId: "$message",
      cursor: "native-token",
    })
  ).toMatchObject({
    items: [{ emoji: "❤️", person: { name: "Ana", username: "ana" } }],
    nextCursor: "native-next",
  });
  expect(mocks.request.mock.calls[1]?.[1]).toContain("from=native-token");
});
it("revalidates access after reading the reactor page", async () => {
  mocks.access
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Access revoked"));
  mocks.request
    .mockResolvedValueOnce({
      event_id: "$message",
      type: "m.room.message",
      sender: "@person:test",
      content: { body: "Hello" },
    })
    .mockResolvedValueOnce({ chunk: [reaction] });
  await expect(
    readMatrixReactors(actor, { id, messageId: "$message" })
  ).rejects.toThrow("Access revoked");
});

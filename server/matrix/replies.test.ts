import { beforeEach, expect, it, vi } from "vitest";
import { matrixReplyRelation } from "./replies";
import { MatrixError, type matrixRequest } from "./client";

const mocks = vi.hoisted(() => ({ request: vi.fn<typeof matrixRequest>() }));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
}));
beforeEach(() => {
  mocks.request.mockReset();
});

it("preserves the root while replying to a message inside a thread", async () => {
  mocks.request.mockResolvedValue({
    event_id: "$child",
    type: "m.room.message",
    sender: "@person:test",
    content: {
      body: "Zoen, help",
      "m.relates_to": { rel_type: "m.thread", event_id: "$root" },
    },
  });
  expect(
    await matrixReplyRelation("!room:test", "$child", "@bot:test")
  ).toEqual({
    "m.in_reply_to": { event_id: "$child" },
    rel_type: "m.thread",
    event_id: "$root",
    is_falling_back: true,
  });
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
    "GET",
    "rooms/!room%3Atest/event/%24child",
    undefined,
    "@bot:test"
  );
});
it("keeps ordinary replies out of threads", async () => {
  mocks.request.mockResolvedValue({
    event_id: "$message",
    type: "m.room.message",
    sender: "@person:test",
    content: { body: "Hello" },
  });
  expect(await matrixReplyRelation("!room:test", "$message")).toEqual({
    "m.in_reply_to": { event_id: "$message" },
  });
});
it("does not publish against an unrelated event", async () => {
  mocks.request.mockResolvedValue({
    event_id: "$other",
    type: "m.room.message",
    sender: "@person:test",
    content: { body: "Other" },
  });
  await expect(matrixReplyRelation("!room:test", "$message")).rejects.toThrow(
    MatrixError
  );
});

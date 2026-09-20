import { beforeEach, expect, it, vi } from "vitest";
import { MatrixEventSchema } from "./client";
import type { matrixRequest } from "./client";
import type { requireWorkspaceAccess } from "../workspaces/access";
import { readMatrixMessages } from "./rooms";

const mocks = vi.hoisted(() => ({
  request: vi.fn<typeof matrixRequest>(),
  access: vi.fn<typeof requireWorkspaceAccess>(),
}));

vi.mock("@db/queries", () => ({
  transaction: async (operation: () => Promise<unknown>) => operation(),
  query: async () => [
    {
      id: "binding",
      roomId: "!room:matrix.test",
      label: "Team room",
      epoch: "epoch",
      matrixId: "@member:matrix.test",
      name: "Member",
    },
  ],
}));
vi.mock("../workspaces/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workspaces/access")>()),
  requireWorkspaceAccess: mocks.access,
}));
vi.mock("./identities", () => ({
  ensureMatrixIdentity: async () => "@member:matrix.test",
}));
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({
    botId: "@zoen:matrix.test",
    serverName: "matrix.test",
  }),
}));

const actor = {
  userId: "member",
  workspaceId: "workspace",
  workspaceKind: "company" as const,
  authSessionId: "session",
};

beforeEach(() => {
  mocks.request.mockReset();
  mocks.access.mockReset().mockResolvedValue({
    ...actor,
    role: "member",
    organizationId: "team",
  });
});

it("projects native Matrix reactions onto their message, counting each sender once", async () => {
  const message = {
    event_id: "$message",
    type: "m.room.message",
    sender: "@member:matrix.test",
    content: { body: "Zoen, react to this", msgtype: "m.text" },
  };
  const reaction = {
    event_id: "$reaction",
    type: "m.reaction",
    sender: "@zoen:matrix.test",
    content: {
      "m.relates_to": {
        rel_type: "m.annotation",
        event_id: "$message",
        key: "❤️",
      },
    },
  };
  mocks.request.mockResolvedValue({
    chunk: [
      { ...reaction, event_id: "$redacted", content: {} },
      {
        ...reaction,
        event_id: "$unrelated",
        content: {
          "m.relates_to": {
            ...reaction.content["m.relates_to"],
            event_id: "$other-message",
          },
        },
      },
      { ...reaction, event_id: "$member-reaction", sender: message.sender },
      { ...reaction, event_id: "$duplicate-sender" },
      reaction,
      message,
    ],
  });

  const result = await readMatrixMessages(actor, "binding");

  expect(result.messages).toEqual([
    {
      id: "$message",
      text: "Zoen, react to this",
      sender: "Member",
      mine: true,
      timestamp: 0,
      reactions: [{ type: "heart", count: 2 }],
    },
  ]);
  expect(mocks.request).toHaveBeenCalledWith(
    "GET",
    expect.stringContaining(
      encodeURIComponent(
        JSON.stringify({ types: ["m.room.message", "m.reaction"] })
      )
    ),
    undefined,
    "@member:matrix.test"
  );
  expect(mocks.access).toHaveBeenCalledTimes(4);
});

it("does not request room events after workspace access is revoked", async () => {
  mocks.access.mockRejectedValue(new Error("Access revoked"));
  await expect(readMatrixMessages(actor, "binding")).rejects.toThrow(
    "Access revoked"
  );
  expect(mocks.request).not.toHaveBeenCalled();
});

it("preserves Matrix reaction relation data without requiring it on normal messages", () => {
  expect(
    MatrixEventSchema.parse({
      event_id: "$reaction",
      type: "m.reaction",
      sender: "@zoen:matrix.test",
      content: {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: "$message",
          key: "👍",
        },
      },
    }).content["m.relates_to"]
  ).toEqual({ rel_type: "m.annotation", event_id: "$message", key: "👍" });
});

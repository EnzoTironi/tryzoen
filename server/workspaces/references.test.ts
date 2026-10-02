import { beforeEach, expect, test, vi } from "vitest";
import { WorkspaceAccessDenied } from "./access";
import { searchComposerReferences } from "./references";

const mocks = vi.hoisted(() => ({
  admission: vi.fn<(...args: unknown[]) => Promise<void>>(),
  access: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  joined: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  join: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  history: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  members: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  repository: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  reminders: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  directory: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  bots: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("@db/queries", () => ({
  transaction: (run: () => Promise<unknown>) => run(),
}));
vi.mock("../matrix/authority", () => ({
  lockMatrixAdmission: mocks.admission,
}));
vi.mock("./access", async (original) => ({
  ...(await original<typeof import("./access")>()),
  requireWorkspaceAccess: mocks.access,
}));
vi.mock("../matrix/rooms", () => ({
  requireJoinedMatrixRoom: mocks.joined,
  joinMatrixRoom: mocks.join,
  readMatrixMessages: mocks.history,
}));
vi.mock("../matrix/members", () => ({ readRoomMembers: mocks.members }));
vi.mock("./repository", () => ({
  WorkspaceRepository: { read: mocks.repository },
}));
vi.mock("../schedules/queries", () => ({ listReminders: mocks.reminders }));
vi.mock("../accounts/directory", () => ({ searchDirectory: mocks.directory }));
vi.mock("./bots", () => ({ searchWorkspaceBots: mocks.bots }));

const actor = {
  userId: "better-auth:viewer",
  workspaceId: "company",
  authSessionId: "session",
};
const room = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "group",
  epoch: "epoch",
  matrixId: "@viewer:zoen.test",
  roomId: "!room:zoen.test",
};
const group = {
  userId: actor.userId,
  workspaceId: actor.workspaceId,
  groupBindingId: room.id,
  groupEpoch: room.epoch,
  matrixIdentityId: room.matrixId,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admission.mockReset().mockResolvedValue(undefined);
  mocks.access.mockReset().mockResolvedValue({});
  mocks.joined.mockReset().mockResolvedValue(room);
  mocks.join
    .mockReset()
    .mockRejectedValue(new Error("Reference lookup must not enroll"));
  mocks.history
    .mockReset()
    .mockRejectedValue(new Error("Reference lookup must not load history"));
  mocks.members.mockReset().mockResolvedValue([
    { id: "@peer:zoen.test", name: "Peer", username: "peer", bot: false },
    { id: "@agent:zoen.test", name: "Helper", username: "helper", bot: true },
  ]);
  mocks.repository
    .mockReset()
    .mockResolvedValue({ files: ["knowledge/team.md", "skills/plan.md"] });
  mocks.reminders.mockReset().mockResolvedValue({
    reminders: [{ id: "routine", prompt: "Daily forecast", status: "active" }],
  });
  mocks.directory.mockReset().mockResolvedValue([{ username: "peer" }]);
  mocks.bots
    .mockReset()
    .mockResolvedValue([{ username: "helper", name: "Helper" }]);
});

test.each(["@", "$", "/"] as const)(
  "%s lookup in a selected group never enrolls or loads history",
  async (trigger) => {
    await searchComposerReferences(actor, {
      trigger,
      query: "",
      roomId: room.id,
    });
    expect(mocks.joined).toHaveBeenCalledExactlyOnceWith(actor, room.id);
    expect(mocks.join).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.directory).not.toHaveBeenCalled();
    expect(mocks.bots).not.toHaveBeenCalled();
    expect(mocks.reminders.mock.calls).toEqual(
      trigger === "/" ? [[group]] : []
    );
    expect(mocks.repository.mock.calls).toEqual(
      trigger === "/" ? [] : [[group]]
    );
  }
);

test("person mentions use the bounded authorized roster and preserve agent identity", async () => {
  expect(
    await searchComposerReferences(actor, {
      trigger: "@",
      query: "",
      roomId: room.id,
    })
  ).toEqual([
    {
      id: "peer",
      kind: "person",
      title: "Peer",
      detail: "@peer",
      token: "@peer",
    },
    {
      id: "helper",
      kind: "bot",
      title: "Helper",
      detail: "@helper",
      token: "@helper",
    },
    {
      id: "knowledge/team.md",
      kind: "file",
      title: "team.md",
      detail: "knowledge/team.md",
      token: "@knowledge/team.md",
    },
  ]);
  expect(mocks.members).toHaveBeenCalledExactlyOnceWith(
    actor,
    room.id,
    "group"
  );
  expect(mocks.history).not.toHaveBeenCalled();
});

test("pending or revoked room membership denies before files, roster or routines are read", async () => {
  mocks.joined.mockRejectedValue(new WorkspaceAccessDenied());
  await expect(
    searchComposerReferences(actor, {
      trigger: "@",
      query: "",
      roomId: room.id,
    })
  ).rejects.toThrow(WorkspaceAccessDenied);
  expect(mocks.repository).not.toHaveBeenCalled();
  expect(mocks.members).not.toHaveBeenCalled();
  expect(mocks.reminders).not.toHaveBeenCalled();
  expect(mocks.join).not.toHaveBeenCalled();
});

test("organization and room admission precede actor authorization and roster lookup", async () => {
  const order: string[] = [];
  mocks.admission.mockImplementation(async () => {
    order.push("admission");
  });
  mocks.access.mockImplementation(async () => {
    order.push("access");
    return {};
  });
  mocks.joined.mockImplementation(async () => {
    order.push("joined");
    return room;
  });
  mocks.members.mockImplementation(async () => {
    order.push("members");
    return [];
  });
  await searchComposerReferences(actor, {
    trigger: "@",
    query: "",
    roomId: room.id,
  });
  expect(mocks.admission).toHaveBeenCalledExactlyOnceWith(
    [actor.workspaceId],
    [room.id]
  );
  expect(order).toEqual(["admission", "access", "joined", "members"]);
});

test("private references retain their authenticated scope and do not inspect a room", async () => {
  const result = await searchComposerReferences(actor, {
    trigger: "@",
    query: "peer",
  });
  expect(result).toContainEqual({
    id: "peer",
    kind: "person",
    title: "peer",
    detail: "@peer",
    token: "@peer",
  });
  expect(mocks.admission).toHaveBeenCalledExactlyOnceWith(
    [actor.workspaceId],
    []
  );
  expect(mocks.repository).toHaveBeenCalledExactlyOnceWith(actor);
  expect(mocks.directory).toHaveBeenCalledExactlyOnceWith(actor, "peer");
  expect(mocks.joined).not.toHaveBeenCalled();
  expect(mocks.members).not.toHaveBeenCalled();
});

test("skill lookup does not query people or native history", async () => {
  expect(
    await searchComposerReferences(actor, {
      trigger: "$",
      query: "plan",
      roomId: room.id,
    })
  ).toEqual([
    {
      id: "skills/plan.md",
      kind: "skill",
      title: "plan.md",
      detail: "skills/plan.md",
      token: "$skills/plan.md",
    },
  ]);
  expect(mocks.members).not.toHaveBeenCalled();
  expect(mocks.history).not.toHaveBeenCalled();
  expect(mocks.directory).not.toHaveBeenCalled();
});

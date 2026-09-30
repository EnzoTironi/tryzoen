/** Resolver harness: the workspace actor and participation service are mocked at
 * their owners. This proves routing/validation/error encoding, not authorization,
 * native membership, provider completion, or PostgreSQL concurrency. */
import { beforeEach, expect, it, vi } from "vitest";
import { createTRPCRouter } from "./init";
import { workspaceRoomsRouter } from "./workspace-rooms";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import type { ensureMatrixParticipation } from "../../server/matrix/participation";
import { operationSignal } from "../../server/operations/async";

const mocks = vi.hoisted(() => ({
  actor: {
    userId: "better-auth:viewer",
    workspaceId: "selected-workspace",
    authSessionId: "session",
  },
  participate: vi.fn<typeof ensureMatrixParticipation>(),
  execute: vi.fn<(...args: unknown[]) => Promise<never>>(),
  transaction: vi.fn<(...args: unknown[]) => Promise<never>>(),
}));
vi.mock("@db", () => ({
  db: { execute: mocks.execute, transaction: mocks.transaction },
}));
vi.mock("./workspace-procedure", async () => {
  const { protectedProcedure } = await import("./init");
  return {
    workspaceProcedure: protectedProcedure.use(({ next }) =>
      next({ ctx: { actor: mocks.actor } })
    ),
  };
});
vi.mock("../../server/matrix/participation", () => ({
  ensureMatrixParticipation: mocks.participate,
}));
const router = createTRPCRouter({
  participate: workspaceRoomsRouter.participate,
});
const caller = () =>
  router.createCaller({
    requestHeaders: new Headers(),
    scope: { userId: mocks.actor.userId, workspaceId: mocks.actor.workspaceId },
  });
const id = "00000000-0000-4000-8000-000000000001";
const room = {
  id,
  workspaceId: mocks.actor.workspaceId,
  roomId: "!room:test",
  label: "Synthetic room",
  epoch: "00000000-0000-4000-8000-000000000002",
  kind: "group" as const,
};
beforeEach(() => {
  mocks.participate.mockReset();
  mocks.execute
    .mockReset()
    .mockRejectedValue(
      new Error("Unexpected database call in resolver harness")
    );
  mocks.transaction
    .mockReset()
    .mockRejectedValue(
      new Error("Unexpected transaction wrapper in resolver harness")
    );
});

it.each([
  { status: "joined" as const, room },
  { status: "pending" as const, id, retryAfterMs: 1000 },
])(
  "returns explicit participation status $status with the current workspace actor",
  async (receipt) => {
    const signals: AbortSignal[] = [];
    mocks.participate.mockImplementation(async () => {
      signals.push(operationSignal());
      return receipt;
    });
    const input = {
      id,
      workspaceId: "spoofed-workspace",
      userId: "spoofed-user",
    };
    expect(await caller().participate(input)).toEqual(receipt);
    expect(mocks.participate).toHaveBeenCalledExactlyOnceWith(mocks.actor, id);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  }
);

it("validates the binding ID before calling the participation service", async () => {
  await expect(
    caller().participate({ id: "not-a-binding-id" })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(mocks.participate).not.toHaveBeenCalled();
});

it("encodes only the owning access denial as terminal forbidden", async () => {
  const denial = new WorkspaceAccessDenied();
  mocks.participate.mockRejectedValue(denial);
  await expect(caller().participate({ id })).rejects.toMatchObject({
    code: "FORBIDDEN",
    cause: denial,
  });
  expect(mocks.participate).toHaveBeenCalledOnce();
});

it("keeps unexpected service errors distinct from forbidden and pending", async () => {
  const error = new Error("Synthetic temporary failure");
  mocks.participate.mockRejectedValue(error);
  await expect(caller().participate({ id })).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    cause: error,
  });
  expect(mocks.participate).toHaveBeenCalledOnce();
});

it("rejects a malformed pending receipt instead of exposing native state", async () => {
  const receipt = { status: "pending" as const, id, retryAfterMs: 1000, room };
  mocks.participate.mockResolvedValue(receipt);
  await expect(caller().participate({ id })).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
  });
  expect(mocks.participate).toHaveBeenCalledOnce();
});

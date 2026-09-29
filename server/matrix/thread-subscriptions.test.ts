import { beforeEach, expect, test, vi } from "vitest";
import { MatrixError } from "./client";
import {
  readThreadSubscription,
  setThreadSubscription,
} from "./thread-subscriptions";
import { WorkspaceAccessDenied } from "../workspaces/access";

const mocks = vi.hoisted(() => ({
  join: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  access: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  message: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  request: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("@db/queries", () => ({
  query: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  transaction: (run: () => Promise<unknown>) => run(),
}));
vi.mock("./rooms", () => ({
  joinMatrixRoom: mocks.join,
  requireMatrixRoom: mocks.access,
}));
vi.mock("./messages", () => ({ readRoomMessage: mocks.message }));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixRequest: mocks.request,
}));
const actor = {
  userId: "viewer",
  authSessionId: "session",
  workspaceId: "workspace",
};
const input = { id: "00000000-0000-4000-8000-000000000001", rootId: "$root" };
beforeEach(() => {
  mocks.join
    .mockReset()
    .mockResolvedValue({ roomId: "!room:test", matrixId: "@viewer:test" });
  mocks.access.mockReset().mockResolvedValue({});
  mocks.message.mockReset().mockResolvedValue({ content: {} });
  mocks.request.mockReset();
});
test("unsupported homeservers never expose a synthetic subscription", async () => {
  mocks.request.mockResolvedValue({
    unstable_features: { "org.matrix.msc4306": false },
  });
  expect(await readThreadSubscription(actor, input)).toEqual({
    status: "unsupported",
  });
  expect(
    await setThreadSubscription(actor, { ...input, following: true })
  ).toEqual({ status: "unsupported" });
  expect(
    mocks.request.mock.calls.every(
      ([method, path]) => method === "GET" && path === "versions"
    )
  ).toBe(true);
});
test("missing subscription is distinct from provider failure", async () => {
  mocks.request
    .mockResolvedValueOnce({
      unstable_features: { "org.matrix.msc4306": true },
    })
    .mockRejectedValueOnce(new MatrixError({ reason: "not-found" }));
  expect(await readThreadSubscription(actor, input)).toEqual({
    status: "ready",
    following: false,
    automatic: false,
  });
  mocks.request
    .mockResolvedValueOnce({
      unstable_features: { "org.matrix.msc4306": true },
    })
    .mockRejectedValueOnce(new MatrixError({ reason: "unavailable" }));
  await expect(readThreadSubscription(actor, input)).rejects.toThrow(
    MatrixError
  );
});
test("a thread reply cannot be substituted for its root and revoked reads fail", async () => {
  mocks.message.mockResolvedValue({
    content: {
      "m.relates_to": { rel_type: "m.thread", event_id: "$different" },
    },
  });
  await expect(readThreadSubscription(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.message.mockResolvedValue({ content: {} });
  mocks.request
    .mockResolvedValueOnce({
      unstable_features: { "org.matrix.msc4306": true },
    })
    .mockResolvedValueOnce({ automatic: false });
  mocks.access
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(readThreadSubscription(actor, input)).rejects.toThrow(
    WorkspaceAccessDenied
  );
});

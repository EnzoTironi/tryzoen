import { beforeEach, expect, it, vi } from "vitest";
import { createTRPCRouter } from "./init";
import { externalAgentsRouter } from "./agent-members";
import { ExternalAgentMemberError } from "../../server/workspaces/agent-members";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import type {
  registerExternalAgentMember,
  listExternalAgentMembers,
} from "../../server/workspaces/agent-members";

const mocks = vi.hoisted(() => ({
  actor: {
    userId: "better-auth:manager",
    workspaceId: "workspace",
    authSessionId: "session",
  },
  register: vi.fn<typeof registerExternalAgentMember>(),
  list: vi.fn<typeof listExternalAgentMembers>(),
}));
vi.mock("./workspace-procedure", async () => {
  const { protectedProcedure } = await import("./init");
  return {
    workspaceProcedure: protectedProcedure.use(({ next }) =>
      next({ ctx: { actor: mocks.actor } })
    ),
  };
});
vi.mock("../../server/workspaces/agent-members", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../server/workspaces/agent-members")
  >()),
  registerExternalAgentMember: mocks.register,
  listExternalAgentMembers: mocks.list,
}));
const router = createTRPCRouter({ externalAgents: externalAgentsRouter });
const caller = () =>
  router.createCaller({
    requestHeaders: new Headers(),
    scope: { userId: mocks.actor.userId, workspaceId: mocks.actor.workspaceId },
  });
const id = "96e65b40-e8ad-4669-925d-7f8e394bd4b0";
const input = {
  operationId: "d7a35d64-3b8e-454c-8a01-bf220ff0c08c",
  username: "helper",
  name: "External helper",
};
const member = {
  id,
  workspaceId: "workspace",
  username: "helper",
  name: "External helper",
  description: "",
  principal: `agent:${id}`,
  createdBy: mocks.actor.userId,
  createdAt: new Date("2026-09-30"),
  revokedAt: null,
  status: "registered" as const,
};
beforeEach(() => {
  mocks.register.mockReset().mockResolvedValue({ applied: true, member });
  mocks.list
    .mockReset()
    .mockResolvedValue({ members: [member], nextCursor: null });
});

it("passes only canonical registration fields with the authenticated workspace actor", async () => {
  expect(
    await caller().externalAgents.register({
      ...input,
      name: "  External helper  ",
    })
  ).toEqual({ applied: true, member });
  expect(mocks.register).toHaveBeenCalledWith(mocks.actor, {
    ...input,
    description: "",
  });
  expect(await caller().externalAgents.list({})).toEqual({
    members: [member],
    nextCursor: null,
  });
  expect(mocks.list).toHaveBeenCalledWith(mocks.actor, { limit: 50 });
});
it("rejects injected identity/authority before registration", async () => {
  const injected = { ...input, createdBy: "spoofed" };
  await expect(
    caller().externalAgents.register(injected)
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(mocks.register).not.toHaveBeenCalled();
});
it.each([
  ["invalid_input", "BAD_REQUEST"],
  ["conflict", "CONFLICT"],
  ["unavailable", "INTERNAL_SERVER_ERROR"],
] as const)("maps %s to %s", async (reason, code) => {
  mocks.register.mockRejectedValueOnce(new ExternalAgentMemberError(reason));
  await expect(caller().externalAgents.register(input)).rejects.toMatchObject({
    code,
  });
});
it("maps permission failures on both endpoints to forbidden", async () => {
  mocks.register.mockRejectedValueOnce(new WorkspaceAccessDenied());
  mocks.list.mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(caller().externalAgents.register(input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(caller().externalAgents.list({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("preserves replay and revoked status rather than reporting a connection", async () => {
  mocks.register.mockResolvedValueOnce({
    applied: false,
    member: { ...member, revokedAt: new Date("2026-10-01"), status: "revoked" },
  });
  expect(await caller().externalAgents.register(input)).toMatchObject({
    applied: false,
    member: { id, status: "revoked" },
  });
});

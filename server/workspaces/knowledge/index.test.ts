import { beforeEach, expect, test, vi } from "vitest";
import { ZodError } from "zod";
import { WorkspaceRepositoryError } from "../repository";
import { WorkspaceAccessDenied } from "../access";
import { readKnowledgeProposal, reviewKnowledgeProposal } from "./index";

const boundary = vi.hoisted(() => ({
  read: vi.fn<typeof import("../repository").WorkspaceRepository.read>(),
  access: vi.fn<typeof import("../access").requireWorkspaceAccess>(),
  write: vi.fn<typeof import("../repository").WorkspaceRepository.write>(),
  publish: vi.fn<typeof import("../repository").WorkspaceRepository.publish>(),
}));
vi.mock("../repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repository")>()),
  WorkspaceRepository: {
    read: boundary.read,
    write: boundary.write,
    publish: boundary.publish,
  },
}));
vi.mock("../access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../access")>()),
  requireWorkspaceAccess: boundary.access,
}));

const actor = {
  userId: "synthetic-proposal-reader",
  workspaceId: "synthetic-workspace",
  authSessionId: "synthetic-auth-session",
};
const path = "proposals/knowledge/10000000-0000-4000-8000-000000000001.json";

beforeEach(() => {
  vi.resetAllMocks();
  boundary.access.mockResolvedValue({
    ...actor,
    role: "owner",
    organizationId: null,
  });
});

test("an absent proposal in an empty repository has the same not-found contract as an absent file", async () => {
  boundary.read.mockResolvedValue({ revision: null, content: null, files: [] });
  await expect(readKnowledgeProposal(actor, path)).rejects.toMatchObject({
    _tag: "WorkspaceRepositoryError",
    reason: "not_found",
  });
  expect(boundary.read).toHaveBeenCalledExactlyOnceWith(actor, path);
});

test("an existing repository's not-found rejection is preserved", async () => {
  const failure = new WorkspaceRepositoryError({ reason: "not_found" });
  boundary.read.mockRejectedValue(failure);
  await expect(readKnowledgeProposal(actor, path)).rejects.toBe(failure);
});

test.each(["", "{}"])(
  "a present malformed proposal (%j) is not disguised as absent",
  async (content) => {
    boundary.read.mockResolvedValue({
      revision: "a".repeat(40),
      content,
      files: [path],
    });
    await expect(readKnowledgeProposal(actor, path)).rejects.toBeInstanceOf(
      ZodError
    );
  }
);

test("access denial precedes the proposal lookup", async () => {
  const failure = new WorkspaceAccessDenied();
  boundary.access.mockRejectedValue(failure);
  await expect(readKnowledgeProposal(actor, path)).rejects.toBe(failure);
  expect(boundary.read).not.toHaveBeenCalled();
});

test("an invalid proposal path never reaches the repository", async () => {
  await expect(
    readKnowledgeProposal(actor, "knowledge/purpose.md")
  ).rejects.toBeInstanceOf(ZodError);
  expect(boundary.read).not.toHaveBeenCalled();
});

test.each(["approve", "reject"] as const)(
  "reviewing an absent proposal (%s) cannot publish or record a rejection",
  async (decision) => {
    boundary.read.mockResolvedValue({
      revision: null,
      content: null,
      files: [],
    });
    await expect(
      reviewKnowledgeProposal(actor, {
        operationId: "10000000-0000-4000-8000-000000000002",
        expectedRevision: null,
        proposal: path,
        decision,
      })
    ).rejects.toMatchObject({
      _tag: "WorkspaceRepositoryError",
      reason: "not_found",
    });
    expect(boundary.write).not.toHaveBeenCalled();
    expect(boundary.publish).not.toHaveBeenCalled();
  }
);

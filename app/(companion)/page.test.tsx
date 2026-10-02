import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CompanionHome from "./page";

const mocks = vi.hoisted(() => ({ documents: [{ path: "", content: "" }] }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@web/auth/request-scope", () => ({
  requireRequestScope: async () => ({
    userId: "user-1",
    workspaceId: "personal-1",
  }),
}));
vi.mock("../../server/workspaces/session", () => ({
  resolveWorkspaceActor: async () => ({
    userId: "user-1",
    workspaceId: "personal-1",
  }),
}));
vi.mock("../../server/workspaces/repository", () => ({
  WorkspaceRepository: {
    selection: async () => ({ documents: mocks.documents, revision: "saved" }),
  },
}));
vi.mock("../companion/client", () => ({ CompanionClient: () => null }));

beforeEach(() => {
  mocks.documents = [];
});
describe("Companion app home", () => {
  it("sends a new account to Companion setup", async () => {
    await expect(CompanionHome()).rejects.toMatchObject({
      digest: expect.stringContaining(";/onboarding;"),
    });
  });
  it("opens Companion with the account's own draft scope after setup", async () => {
    mocks.documents = [{ path: "agent/IDENTITY.md", content: "Name: Sol\n" }];
    const page = await CompanionHome();
    expect(isValidElement(page)).toBe(true);
    expect(page.props.draftScope).toBe(
      JSON.stringify(["personal-1", "user-1"])
    );
  });
});

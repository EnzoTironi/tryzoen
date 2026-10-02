import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessScopeForUser } from "@shared/identity/access-scope";
import type { CompanionClient } from "../companion/client";
import CompanionHome from "./page";

const mocks = vi.hoisted(() => ({
  documents: [{ path: "", content: "" }],
  shared: false,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`Redirected to ${url}`);
  },
}));
vi.mock("@web/auth/request-scope", () => ({
  requireRequestScope: async () => {
    const personal = accessScopeForUser("user-1");
    return mocks.shared ? { ...personal, workspaceId: "team-1" } : personal;
  },
}));
vi.mock("../../server/workspaces/session", () => ({
  resolveWorkspaceActor: async () => accessScopeForUser("user-1"),
}));
vi.mock("../../server/workspaces/repository", () => ({
  WorkspaceRepository: {
    selection: async () => ({ documents: mocks.documents, revision: "saved" }),
  },
}));
vi.mock("../companion/client", () => ({ CompanionClient: () => null }));

beforeEach(() => {
  mocks.documents = [];
  mocks.shared = false;
});
describe("Companion app home", () => {
  it("sends a new account to Companion setup", async () => {
    await expect(CompanionHome()).rejects.toThrow("Redirected to /onboarding");
  });
  it("opens Companion with the account's own draft scope after setup", async () => {
    mocks.documents = [{ path: "agent/IDENTITY.md", content: "Name: Sol\n" }];
    const page: unknown = await CompanionHome();
    if (!isValidElement<Parameters<typeof CompanionClient>[0]>(page))
      throw new Error("Companion did not render");
    expect(page.props.draftScope).toBe(
      JSON.stringify([accessScopeForUser("user-1").workspaceId, "user-1"])
    );
  });
  it("does not redirect a selected team into personal onboarding", async () => {
    mocks.shared = true;
    const page: unknown = await CompanionHome();
    if (!isValidElement<Parameters<typeof CompanionClient>[0]>(page))
      throw new Error("Companion did not render");
    expect(page.props.draftScope).toBe(JSON.stringify(["team-1", "user-1"]));
  });
});

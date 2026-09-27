import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { requireRequestScope } from "@web/auth/request-scope";
import { isSessionOwned } from "@db/services/sessions";
import { readChat } from "@db/services/chats";
import CompanionPage from "@app/companion/[[...session]]/page";

vi.mock("@web/auth/request-scope", () => ({
  requireRequestScope: vi.fn<typeof requireRequestScope>(),
}));
vi.mock("@db/services/sessions", () => ({
  isSessionOwned: vi.fn<typeof isSessionOwned>(),
}));
vi.mock("@db/services/chats", () => ({ readChat: vi.fn<typeof readChat>() }));
vi.mock("@app/companion/client", () => ({ CompanionClient: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));

const scope = accessScopeForUser("better-auth:companion-test");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireRequestScope).mockResolvedValue(scope);
  vi.mocked(isSessionOwned).mockResolvedValue(false);
  vi.mocked(readChat).mockResolvedValue(undefined);
});

describe("companion route authorization", () => {
  it("rejects another workspace’s session before reading chat metadata", async () => {
    await expect(
      CompanionPage({
        params: Promise.resolve({ session: ["other-session"] }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("not found");
    expect(isSessionOwned).toHaveBeenCalledExactlyOnceWith(
      scope,
      "other-session"
    );
    expect(readChat).not.toHaveBeenCalled();
  });

  it("reads an owned conversation through the authenticated scope", async () => {
    vi.mocked(isSessionOwned).mockResolvedValue(true);
    const page = await CompanionPage({
      params: Promise.resolve({ session: ["owned-session"] }),
      searchParams: Promise.resolve({}),
    });
    expect(readChat).toHaveBeenCalledExactlyOnceWith(scope, "owned-session");
    expect(page.key).toBe(`${scope.workspaceId}:owned-session`);
  });

  it("does not read any conversation for the new-conversation route", async () => {
    await CompanionPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({}),
    });
    expect(isSessionOwned).not.toHaveBeenCalled();
    expect(readChat).not.toHaveBeenCalled();
  });

  it("rejects malformed multi-segment paths before querying ownership", async () => {
    await expect(
      CompanionPage({
        params: Promise.resolve({ session: ["one", "two"] }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("not found");
    expect(isSessionOwned).not.toHaveBeenCalled();
    expect(readChat).not.toHaveBeenCalled();
  });

  it("cannot load chat metadata when authentication or workspace access fails", async () => {
    vi.mocked(requireRequestScope).mockRejectedValue(new Error("unauthorized"));
    await expect(
      CompanionPage({
        params: Promise.resolve({ session: ["owned-session"] }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("unauthorized");
    expect(isSessionOwned).not.toHaveBeenCalled();
    expect(readChat).not.toHaveBeenCalled();
  });
});

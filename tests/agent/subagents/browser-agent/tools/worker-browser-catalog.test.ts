import type { DynamicResolveContext } from "eve/tools";
import type { SessionAuthContext } from "eve/context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import browserTools from "@agent/subagents/browser-agent/tools/browser";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { BrowserWorkerAccess } from "../../../../../server/browser-worker";
import { BrowserWorkerAccessError } from "../../../../../server/browser-worker/access";

const scope = accessScopeForUser("better-auth:alice");
const principal: SessionAuthContext = {
  authenticator: "authjs",
  principalType: "user",
  principalId: scope.userId,
  attributes: {
    authSessionId: "alice-auth-session",
    workspaceId: scope.workspaceId,
  },
};
const context = {
  model: null,
  messages: [],
  channel: { kind: "channel:eve", metadata: {} },
  session: {
    id: "browser-worker-session",
    auth: { current: null, initiator: principal },
  },
} satisfies DynamicResolveContext;
const authorize = vi.spyOn(BrowserWorkerAccess, "authorize");
const resolveTools = browserTools.events["turn.started"];
if (!resolveTools) throw new Error("Browser tool discovery is not configured.");

beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue(scope);
});

describe("browser tool discovery", () => {
  it.each(["current", "initiator"] as const)(
    "uses live %s authority with the public parentless dynamic context",
    async (caller) => {
      const tools = await resolveTools({}, {
        ...context,
        session: {
          ...context.session,
          auth: {
            current: caller === "current" ? principal : null,
            initiator: caller === "initiator" ? principal : null,
          },
        },
      } satisfies DynamicResolveContext);

      expect(tools).toHaveProperty("manage_browsers");
      expect(tools).toHaveProperty("browser_snapshot");
      expect(tools).toHaveProperty("playwright_execute");
      expect(authorize).toHaveBeenCalledExactlyOnceWith(principal);
    }
  );

  it("rejects anonymous discovery", async () => {
    await expect(
      resolveTools({}, {
        ...context,
        session: {
          ...context.session,
          auth: { current: null, initiator: null },
        },
      } satisfies DynamicResolveContext)
    ).rejects.toThrow("An authenticated user is required.");
    expect(authorize).not.toHaveBeenCalled();
  });

  it("does not fall back to the initiator when current authority is revoked", async () => {
    const revoked: SessionAuthContext = {
      ...principal,
      authenticator: "verified-channel",
      attributes: {
        workspaceId: scope.workspaceId,
        channelIdentityId: "11111111-1111-4111-8111-111111111111",
        conversationChannel: "telegram",
      },
    };
    authorize.mockRejectedValueOnce(
      new BrowserWorkerAccessError({ reason: "revoked" })
    );

    await expect(
      resolveTools({}, {
        ...context,
        session: {
          ...context.session,
          auth: { current: revoked, initiator: principal },
        },
      } satisfies DynamicResolveContext)
    ).rejects.toThrow("The caller's channel authority has been revoked.");
    expect(authorize).toHaveBeenCalledExactlyOnceWith(revoked);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { accessScopeForUser } from "@shared/identity/access-scope";
import type { SessionAuthContext } from "eve/context";
import { BrowserWorkerAccess } from "./index";
import {
  BrowserWorkerAccessError,
  requireBrowserWorkerChannelIdentity,
  requireBrowserWorkerLease,
  requireBrowserWorkerScheduleActive,
} from "./access";

vi.mock("./access", async (original) => ({
  ...(await original<typeof import("./access")>()),
  requireBrowserWorkerChannelIdentity:
    vi.fn<typeof requireBrowserWorkerChannelIdentity>(),
  requireBrowserWorkerLease: vi.fn<typeof requireBrowserWorkerLease>(),
  requireBrowserWorkerScheduleActive:
    vi.fn<typeof requireBrowserWorkerScheduleActive>(),
}));
afterEach(() => vi.resetAllMocks());
const scope = accessScopeForUser("better-auth:alice");
const principal: SessionAuthContext = {
  principalId: scope.userId,
  principalType: "user",
  authenticator: "verified-channel",
  attributes: {
    channelIdentityId: "11111111-1111-4111-8111-111111111111",
    conversationChannel: "telegram",
    workspaceId: scope.workspaceId,
  },
};

describe("BrowserWorkerAccess live authority", () => {
  it("preserves revocation errors from the identity boundary", async () => {
    vi.mocked(requireBrowserWorkerChannelIdentity).mockRejectedValueOnce(
      new BrowserWorkerAccessError({ reason: "revoked" })
    );
    await expect(
      BrowserWorkerAccess.authorize(principal)
    ).rejects.toMatchObject({ reason: "revoked" });
    expect(requireBrowserWorkerChannelIdentity).toHaveBeenCalledOnce();
  });
  it("checks an active lease and refuses a paused schedule", async () => {
    vi.mocked(requireBrowserWorkerScheduleActive).mockRejectedValueOnce(
      new BrowserWorkerAccessError({ reason: "paused" })
    );
    await expect(
      BrowserWorkerAccess.authorize({
        ...principal,
        authenticator: "scheduled-worker",
        attributes: {
          ...principal.attributes,
          scheduleId: "schedule",
          scheduledRunId: "run",
          scheduledRunLeaseToken: "lease",
        },
      })
    ).rejects.toMatchObject({ reason: "paused" });
    expect(requireBrowserWorkerLease).toHaveBeenCalledOnce();
    expect(requireBrowserWorkerChannelIdentity).not.toHaveBeenCalled();
  });
});

import { accessScopeForUser } from "@shared/identity/access-scope";
import type { DynamicResolveContext } from "eve";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { isScheduledAgentRunLeaseActive } from "@db/services/scheduled-agent-run-leases";
import type { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import type { getGatewayModel } from "@db/services/settings";
import type { requireChannelPrincipal } from "../../server/channels/principal";

const services = vi.hoisted(() => ({
  modelConfiguration: {
    COMPANION_MODEL_PROVIDER: "gateway",
    COMPANION_CODEX_MODEL: "gpt-5.6-luna",
  },
  getModel: vi.fn<typeof getGatewayModel>(),
  isActive: vi.fn<typeof isScheduledAgentRunLeaseActive>(),
  verifyChannel:
    vi.fn<
      (
        ...args: Parameters<typeof requireChannelPrincipal>
      ) => Promise<Awaited<ReturnType<typeof requireChannelPrincipal>>>
    >(),
  resolveActor:
    vi.fn<
      (
        principal: Parameters<typeof workspaceActorFromPrincipal>[0]
      ) => Promise<Awaited<ReturnType<typeof workspaceActorFromPrincipal>>>
    >(),
}));

vi.mock("@db/services/scheduled-agent-run-leases", () => ({
  isScheduledAgentRunLeaseActive: services.isActive,
}));
vi.mock("@db/services/settings", () => ({
  getGatewayModel: services.getModel,
}));
vi.mock("../../server/workspaces/access", () => ({
  workspaceActorFromPrincipal: services.resolveActor,
}));
vi.mock("../../server/channels/principal", () => ({
  requireChannelPrincipal: services.verifyChannel,
}));

vi.mock("@agent/lib/workspace-model", () => ({
  workspaceModel: async () => null,
}));
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target, key): unknown {
        return key in services.modelConfiguration
          ? Reflect.get(services.modelConfiguration, key)
          : Reflect.get(target, key);
      },
    }),
  };
});

import agent from "@agent/agent";

const runId = "00000000-0000-4000-8000-000000000001";
const oldLeaseToken = "00000000-0000-4000-8000-000000000002";
const retryLeaseToken = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.clearAllMocks();
  services.modelConfiguration.COMPANION_MODEL_PROVIDER = "gateway";
  services.getModel.mockResolvedValue("openai/gpt-5.6-sol-fast");
  services.resolveActor.mockReturnValue(
    Promise.resolve({
      ...accessScopeForUser("user-1"),
      role: "owner",
      organizationId: null,
    })
  );
  services.verifyChannel.mockReturnValue(
    Promise.resolve({
      id: "00000000-0000-4000-8000-000000000004",
      userId: "user-1",
      channel: "telegram",
      installationId: "bot",
      senderId: "123",
    })
  );
});

describe("root agent model resolution", () => {
  it("uses the installation model for a verified group without reading private settings", async () => {
    services.modelConfiguration.COMPANION_MODEL_PROVIDER = "codex-local";
    const ctx = groupContext();
    const model = await agent.model.events["step.started"]?.({}, ctx);
    expect(model).toMatchObject({ model: { modelId: "gpt-5.6-luna" } });
    expect(services.verifyChannel).toHaveBeenCalledExactlyOnceWith(
      "telegram",
      ctx.session.auth.current
    );
    expect(services.resolveActor).not.toHaveBeenCalled();
    expect(services.getModel).not.toHaveBeenCalled();
  });

  it("refuses a revoked group sender before choosing a model", async () => {
    services.verifyChannel.mockReturnValue(
      Promise.reject(new Error("Identity revoked"))
    );
    await expect(
      agent.model.events["step.started"]?.({}, groupContext())
    ).rejects.toThrow("Identity revoked");
    expect(services.resolveActor).not.toHaveBeenCalled();
    expect(services.getModel).not.toHaveBeenCalled();
  });

  it("does not fall back to a member's model when group service is unconfigured", async () => {
    await expect(
      agent.model.events["step.started"]?.({}, groupContext())
    ).rejects.toThrow("A model must be configured for group conversations.");
    expect(services.resolveActor).not.toHaveBeenCalled();
    expect(services.getModel).not.toHaveBeenCalled();
  });
  it("accepts a valid retry lease forwarded into an older Eve session", async () => {
    services.isActive.mockImplementation(async (_runId, leaseToken) => {
      return leaseToken === retryLeaseToken;
    });

    const model = await agent.model.events["step.started"]?.(
      {},
      scheduledWorkerContext()
    );

    expect(services.isActive).toHaveBeenCalledExactlyOnceWith(
      runId,
      retryLeaseToken
    );
    expect(services.getModel).toHaveBeenCalledExactlyOnceWith({
      userId: "user-1",
      workspaceId: accessScopeForUser("user-1").workspaceId,
    });
    expect(model).toMatchObject({ modelId: "openai/gpt-5.6-sol-fast" });
    expect(services.resolveActor).toHaveBeenCalledExactlyOnceWith(
      scheduledWorkerContext().session.auth.current
    );
  });

  it("rejects a scheduled worker after its lease is replaced", async () => {
    services.isActive.mockResolvedValue(false);

    await expect(
      agent.model.events["step.started"]?.({}, scheduledWorkerContext())
    ).rejects.toThrow("The scheduled run lease is no longer active.");
    expect(services.getModel).not.toHaveBeenCalled();
    expect(services.resolveActor).not.toHaveBeenCalled();
  });

  it("rejects a valid lease when workspace access was revoked", async () => {
    services.isActive.mockResolvedValue(true);
    services.resolveActor.mockReturnValue(
      Promise.reject(new Error("Workspace access was revoked"))
    );
    await expect(
      agent.model.events["step.started"]?.({}, scheduledWorkerContext())
    ).rejects.toThrow("Workspace access was revoked");
    expect(services.getModel).not.toHaveBeenCalled();
  });
});

function groupContext(): DynamicResolveContext {
  const principal = {
    attributes: {
      workspaceId: accessScopeForUser("user-1").workspaceId,
      conversationChannel: "telegram",
      conversationId: "group:telegram:bot:-1001",
      conversationScope: "group:telegram:bot:-1001",
      chatKind: "group",
    },
    authenticator: "verified-channel",
    principalId: "user-1",
    principalType: "user",
  };
  return {
    model: null,
    channel: { kind: "channel:telegram" },
    messages: [],
    session: {
      auth: { current: principal, initiator: principal },
      id: "group-session",
    },
  };
}

function scheduledWorkerContext(): DynamicResolveContext {
  return {
    model: null,
    channel: { kind: "http" },
    messages: [],
    session: {
      auth: {
        current: {
          attributes: {
            scheduledRunId: runId,
            scheduledRunLeaseToken: retryLeaseToken,
            workspaceId: accessScopeForUser("user-1").workspaceId,
          },
          authenticator: "scheduled-worker",
          principalId: "user-1",
          principalType: "user",
        },
        initiator: {
          attributes: {
            scheduledRunId: runId,
            scheduledRunLeaseToken: oldLeaseToken,
            workspaceId: accessScopeForUser("user-1").workspaceId,
          },
          authenticator: "scheduled-worker",
          principalId: "user-1",
          principalType: "user",
        },
      },
      id: "worker-session",
    },
  };
}

import type * as Connections from "../../../server/connectors/connections";
import type * as Access from "../../../server/workspaces/access";
import type * as Approval from "../../../agent/lib/approval-response";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { McpClientConnectionDefinition } from "eve/connections";
import type { DynamicResolveContext } from "eve/connections";
import type { SessionContext } from "eve/tools";

const mocks = vi.hoisted(() => ({
  actor: vi.fn<typeof Access.workspaceActorFromPrincipal>(),
  list: vi.fn<typeof Connections.listToolConnections>(),
  read: vi.fn<typeof Connections.readToolConnection>(),
  credential: vi.fn<typeof Connections.toolConnectionCredentials>(),
}));

vi.mock("../../../server/workspaces/access", async (original) => ({
  ...(await original<typeof Access>()),
  workspaceActorFromPrincipal: mocks.actor,
}));
vi.mock("../../../server/connectors/connections", () => ({
  listToolConnections: mocks.list,
  readToolConnection: mocks.read,
  toolConnectionCredentials: mocks.credential,
}));
vi.mock("../../../agent/lib/approval-response", () => ({
  authorizeApprovalResponse: vi.fn<typeof Approval.authorizeApprovalResponse>(),
}));
import treg from "../../../agent/connections/treg";

const actor: Awaited<ReturnType<typeof Access.workspaceActorFromPrincipal>> = {
  userId: "alice",
  workspaceId: "alice-workspace",
  role: "owner",
  organizationId: null,
};
const principal = {
  principalId: "alice",
  principalType: "user" as const,
  authenticator: "authjs",
  attributes: { workspaceId: actor.workspaceId },
};
const connection: Awaited<ReturnType<typeof Connections.readToolConnection>> = {
  connected_by: actor.userId,
  operations: [],
  share: "owner",
  id: "62c5ebef-9c20-4e14-827d-b2f6c4f659ff",
  revision: "revision-1",
  kind: "mcp",
  name: "My services",
  endpoint: "https://treg.to/mcp/",
};
const context = {
  model: null,
  messages: [],
  channel: { kind: "http" },
  session: {
    id: "session-1",
    auth: { current: principal, initiator: principal },
  },
} satisfies DynamicResolveContext;
const execution: SessionContext = {
  session: { ...context.session, turn: { id: "turn-1", sequence: 1 } },
  getSandbox: vi.fn<SessionContext["getSandbox"]>(),
  getSkill: vi.fn<SessionContext["getSkill"]>(),
};

const resolve = treg.events["turn.started"];
if (!resolve) throw new Error("Missing Treg resolver");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue(actor);
  mocks.list.mockResolvedValue([connection]);
  mocks.read.mockResolvedValue(connection);
  mocks.credential.mockResolvedValue("private-treg-token");
});

async function connections(): Promise<McpClientConnectionDefinition[]> {
  if (!resolve) throw new Error("Missing Treg resolver");
  const result = await resolve(undefined, context);
  if (!result || "url" in result || "spec" in result)
    throw new Error("Expected connection map");
  return Object.values(result).filter(
    (item): item is McpClientConnectionDefinition => "url" in item
  );
}

function actionConnection(items: McpClientConnectionDefinition[]) {
  const action = items.find(
    (item) =>
      item.tools && "allow" in item.tools && item.tools.allow.includes("call")
  );
  if (!action) throw new Error("Missing Treg action connection");
  return action;
}

describe("Treg native connection", () => {
  test("exposes only catalog reads and approved actions", async () => {
    const items = await connections();
    expect(items).toHaveLength(2);
    expect(items[0]?.tools).toEqual({
      allow: ["catalog_search", "catalog_get", "balance", "my_tools"],
    });
    expect(actionConnection(items).tools).toEqual({ allow: ["call"] });
    expect(actionConnection(items).approval).toHaveProperty("request");
    expect(mocks.credential).not.toHaveBeenCalled();
    expect(JSON.stringify(items)).not.toContain("private-treg-token");
  });

  test("does not expose another MCP endpoint as Treg", async () => {
    mocks.list.mockResolvedValue([
      { ...connection, endpoint: "https://treg.to.attacker.example/mcp/" },
    ]);
    expect(await connections()).toEqual([]);
  });

  test("does not give anonymous or reporting turns access", async () => {
    expect(
      await resolve(undefined, {
        ...context,
        session: {
          ...context.session,
          auth: { current: null, initiator: principal },
        },
      })
    ).toBeNull();
    expect(
      await resolve(undefined, {
        ...context,
        session: {
          ...context.session,
          auth: {
            current: { ...principal, authenticator: "scheduled-result" },
            initiator: principal,
          },
        },
      })
    ).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  test("rechecks the workspace and connection revision before loading a token", async () => {
    const item = actionConnection(await connections());
    if (typeof item.auth !== "function") throw new Error("Missing scoped auth");
    const auth = await item.auth(execution);
    expect(auth).toHaveProperty("credentialOwner", "user");
    // The provider resolves the current session identity independently of token hints.
    await auth.getToken({
      principal: { type: "user", id: "alice" },
      connection: { url: connection.endpoint },
    });
    expect(mocks.credential).toHaveBeenCalledWith(
      actor,
      connection.id,
      connection.revision
    );
    mocks.actor.mockResolvedValue({ ...actor, workspaceId: "bob-workspace" });
    await expect(
      auth.getToken({
        principal: { type: "user", id: "alice" },
        connection: { url: connection.endpoint },
      })
    ).rejects.toThrow("WorkspaceAccessDenied");
    expect(mocks.credential).toHaveBeenCalledTimes(1);
  });

  test("rejects revoked connections before sending headers", async () => {
    const item = actionConnection(await connections());
    if (typeof item.headers !== "function")
      throw new Error("Missing scoped headers");
    mocks.read.mockRejectedValue(new Error("revoked"));
    await expect(item.headers(execution)).rejects.toThrow("revoked");
  });

  test("generates replay-stable keys outside model arguments", async () => {
    const item = actionConnection(await connections());
    const key = item.toolCall?.providedArguments?.idempotency_key;
    if (typeof key !== "function") throw new Error("Missing idempotency key");
    const call = { ...execution, callId: "call-1", toolName: "call" };
    expect(await key(call)).toEqual(await key(call));
    expect(await key(call)).not.toEqual(
      await key({ ...call, callId: "call-2" })
    );
    expect(await key(call)).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("tags costs without putting account identities or credentials in headers", async () => {
    const item = actionConnection(await connections());
    if (typeof item.headers !== "function")
      throw new Error("Missing scoped headers");
    const headers = await item.headers(execution);
    expect(headers["X-Treg-Meta"]).toMatch(
      /^workspace=[a-f0-9]{32},customer=[a-f0-9]{32}$/u
    );
    expect(JSON.stringify(headers)).not.toContain("alice");
    expect(JSON.stringify(headers)).not.toContain("private-treg-token");
  });
});

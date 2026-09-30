/**
 * Deterministic acceptance for the authored network-contact boundary and its
 * real destination resolver. SQL, actor authority, Matrix identity provisioning,
 * transport, and result boundaries are mocked; no database, provider, Eve
 * runtime, credential, or real send runs. Direct executor invocation does not
 * test Eve's approval persistence or prove complete prompt-injection protection.
 * The original username-only implementation sent A's payload to a rebound B;
 * these cases now require the reviewed identity/revision to survive every gate.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "eve/tools";
import {
  type requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type workspaceActorFromPrincipal,
} from "../../server/workspaces/access";
import type {
  openMatrixConversation,
  sendMatrixConversation,
} from "../../server/matrix/conversations";
import type {
  awaitMatrixResult,
  readMatrixResult,
} from "../../server/matrix/result";
import {
  BotProfileSchema,
  type searchWorkspaceBots,
} from "../../server/workspaces/bots";
import type { matrixRequest } from "../../server/matrix/client";
import type {
  ensureMatrixBot,
  ensureMatrixIdentity,
} from "../../server/matrix/identities";
import {
  discoverNetworkBots,
  NetworkContactInputSchema,
  openNetworkBot,
  renderNetworkApproval,
} from "../../server/workspaces/network";
import { workspaceOperationId } from "../../agent/lib/workspace-operation";
import network from "../../server/tools/tools/network";

const mocks = vi.hoisted(() => ({
  actor: vi.fn<typeof workspaceActorFromPrincipal>(),
  access: vi.fn<typeof requireWorkspaceAccess>(),
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  search: vi.fn<typeof searchWorkspaceBots>(),
  open: vi.fn<typeof openMatrixConversation>(),
  send: vi.fn<typeof sendMatrixConversation>(),
  result: vi.fn<typeof awaitMatrixResult>(),
  request: vi.fn<typeof matrixRequest>(),
  ensureBot: vi.fn<typeof ensureMatrixBot>(),
  ensureIdentity: vi.fn<typeof ensureMatrixIdentity>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: (run: () => Promise<unknown>) => run(),
}));
vi.mock("../../server/workspaces/access", async (original) => ({
  ...(await original<typeof import("../../server/workspaces/access")>()),
  workspaceActorFromPrincipal: mocks.actor,
  requireWorkspaceAccess: mocks.access,
}));
vi.mock("../../server/workspaces/bots", async (original) => ({
  ...(await original<typeof import("../../server/workspaces/bots")>()),
  searchWorkspaceBots: mocks.search,
}));
vi.mock("../../server/matrix/conversations", async (original) => ({
  ...(await original<typeof import("../../server/matrix/conversations")>()),
  openMatrixConversation: mocks.open,
  sendMatrixConversation: mocks.send,
}));
vi.mock("../../server/matrix/result", () => ({
  awaitMatrixResult: mocks.result,
  readMatrixResult: vi.fn<typeof readMatrixResult>(),
}));
vi.mock("../../server/matrix/client", async (original) => ({
  ...(await original<typeof import("../../server/matrix/client")>()),
  matrixRequest: mocks.request,
  matrixConfiguration: async () => ({
    serverName: "synthetic.invalid",
    botId: "@zoen:synthetic.invalid",
  }),
}));
vi.mock("../../server/matrix/identities", () => ({
  ensureMatrixBot: mocks.ensureBot,
  ensureMatrixIdentity: mocks.ensureIdentity,
}));
const matrix = await vi.importActual<
  typeof import("../../server/matrix/conversations")
>("../../server/matrix/conversations");

const actor = {
  userId: "better-auth:synthetic-requester",
  workspaceId: "synthetic-source-workspace",
  authSessionId: "synthetic-auth-session",
  role: "owner",
  organizationId: null,
};
const principal = {
  principalType: "user" as const,
  principalId: actor.userId,
  authenticator: "authjs",
  attributes: {
    workspaceId: actor.workspaceId,
    authSessionId: actor.authSessionId,
    chatKind: "private",
  },
};
const execution: ToolContext = {
  callId: "synthetic-approved-call",
  toolName: "network-contact",
  abortSignal: new AbortController().signal,
  session: {
    id: "synthetic-source-session",
    auth: { current: principal, initiator: principal },
    turn: { id: "synthetic-turn", sequence: 1 },
  },
  getSandbox() {
    throw new Error("Sandbox access is forbidden in this acceptance harness.");
  },
  getSkill() {
    throw new Error("Skill access is forbidden in this acceptance harness.");
  },
  getToken() {
    throw new Error(
      "Credential access is forbidden in this acceptance harness."
    );
  },
  requireAuth() {
    throw new Error(
      "Provider authorization is forbidden in this acceptance harness."
    );
  },
};
const bots = {
  approved: {
    id: "10000000-0000-4000-8000-000000000001",
    username: "synthetic_peer",
    name: "Synthetic bot A",
    description: "Recipient selected before approval",
    workspace_id: "synthetic-destination-a",
    organization_id: null,
    issued_by: "better-auth:synthetic-owner-a",
    owner_id: "better-auth:synthetic-owner-a",
    updated_at: "1790769600000000",
  },
  replacement: {
    id: "10000000-0000-4000-8000-000000000002",
    username: "synthetic_peer",
    name: "Synthetic bot B",
    description: "Different recipient after handle reassignment",
    workspace_id: "synthetic-destination-b",
    organization_id: null,
    issued_by: "better-auth:synthetic-owner-b",
    owner_id: "better-auth:synthetic-owner-b",
    updated_at: "1790769600000001",
  },
};
const conversation = {
  id: "20000000-0000-4000-8000-000000000001",
  workspaceId: actor.workspaceId,
  requesterId: actor.userId,
  grantId: "20000000-0000-4000-8000-000000000001",
  roomId: "!synthetic-a:synthetic.invalid",
  senderId: "@synthetic-requester:synthetic.invalid",
  botId: "@synthetic-bot-a:synthetic.invalid",
  username: bots.approved.username,
  name: bots.approved.name,
  description: bots.approved.description,
  destWorkspaceId: bots.approved.workspace_id,
  destBotId: bots.approved.id,
  issuedBy: bots.approved.issued_by,
  networkKind: "personal" as const,
};
const dialect = new PgDialect();
let currentBot = { ...bots.approved };
let blocked = false;
const onTurnStarted = network.events["turn.started"];
if (!onTurnStarted) throw new Error("Network turn handler is required.");
const tools = await onTurnStarted(
  {},
  {
    model: null,
    channel: { kind: "http" },
    messages: [],
    session: execution.session,
  }
);
function contactTool() {
  const contact = tools?.["network-contact"];
  if (!contact) throw new Error("Network contact tool is required.");
  return contact;
}
async function capturedProposal() {
  const [selected] = await discoverNetworkBots(actor, "synthetic");
  if (!selected)
    throw new Error("A synthetic destination must be discoverable.");
  return NetworkContactInputSchema.parse({
    username: selected.username,
    destination: { ...selected.destination },
    text: "Synthetic payload intended only for bot A.",
  });
}
function writes() {
  return mocks.query.mock.calls
    .map(([statement]) => dialect.sqlToQuery(statement).sql)
    .filter((statement) => /^\s*(INSERT|UPDATE|DELETE)\b/u.test(statement));
}
function assertNoEgress() {
  // Assertions live in tests: return observations without claiming DB lock proof.
  return {
    opened: mocks.open.mock.calls.length,
    sent: mocks.send.mock.calls.length,
    results: mocks.result.mock.calls.length,
    providerRequests: mocks.request.mock.calls.length,
    botProvisioning: mocks.ensureBot.mock.calls.length,
    userProvisioning: mocks.ensureIdentity.mock.calls.length,
    writes: writes(),
  };
}
beforeEach(() => {
  currentBot = { ...bots.approved };
  blocked = false;
  mocks.actor.mockReset().mockResolvedValue(actor);
  mocks.access.mockReset().mockResolvedValue(actor);
  mocks.search
    .mockReset()
    .mockResolvedValue([
      BotProfileSchema.parse({ ...bots.approved, discoverable: true }),
    ]);
  mocks.query.mockReset().mockImplementation(async (statement) => {
    const query = dialect.sqlToQuery(statement);
    if (
      query.sql.includes("SELECT id FROM workspace_bots") &&
      query.sql.includes("WHERE username")
    )
      return [{ id: currentBot.id }];
    if (query.sql.includes("SELECT DISTINCT ON (b.id)"))
      return [{ ...currentBot }];
    if (query.sql.includes("FROM personal_trust_blocks"))
      return blocked ? [{ blocked: true }] : [];
    if (query.sql.includes("FROM personal_trust_edges"))
      return [{ authorized: true }];
    if (query.sql.includes("FROM matrix_agent_conversations c JOIN"))
      return [{ ...conversation }];
    if (query.sql.includes("FROM matrix_agent_conversations WHERE"))
      return [{ id: conversation.id }];
    throw new Error(`Unexpected SQL in synthetic harness: ${query.sql}`);
  });
  mocks.open.mockReset().mockResolvedValue({
    ...conversation,
    destActor: {
      userId: conversation.issuedBy,
      workspaceId: conversation.destWorkspaceId,
      agentGrantId: conversation.grantId,
    },
  });
  mocks.send.mockReset().mockResolvedValue({ event_id: "$synthetic-sent" });
  mocks.result.mockReset().mockResolvedValue({
    conversationId: conversation.id,
    eventId: "$synthetic-sent",
    bot: "synthetic_peer",
    state: "TASK_STATE_COMPLETED",
    taskId: "synthetic-task",
    text: "Synthetic answer",
  });
  mocks.request.mockReset();
  mocks.ensureBot.mockReset();
  mocks.ensureIdentity.mockReset();
});

describe("network approval binds its payload to the reviewed recipient", () => {
  it("discovery returns immutable bot/workspace identity and a deterministic revision without writes", async () => {
    const proposal = await capturedProposal();
    expect(proposal.destination).toMatchObject({
      botId: bots.approved.id,
      workspaceId: bots.approved.workspace_id,
    });
    expect(proposal.destination.revision).toMatch(/^[a-f0-9]{64}$/u);
    expect((await capturedProposal()).destination).toEqual(
      proposal.destination
    );
    expect(writes()).toEqual([]);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("passes exact payload and reviewed identity through opening and sending when unchanged", async () => {
    const proposal = await capturedProposal();
    const contact = contactTool();
    expect(contact.approval).toBeDefined();
    await contact.execute(proposal, execution);
    expect(mocks.open).toHaveBeenCalledWith(
      actor,
      proposal.username,
      true,
      proposal.destination
    );
    expect(mocks.send).toHaveBeenCalledWith(
      actor,
      {
        id: conversation.id,
        text: proposal.text,
        operationId: workspaceOperationId(
          execution.session.id,
          execution.callId
        ),
      },
      proposal.destination
    );
    expect(mocks.result).toHaveBeenCalledWith(
      actor,
      conversation.id,
      "$synthetic-sent"
    );
  });
  it("snapshots validated arguments before awaiting authorization so caller mutation cannot change egress", async () => {
    const proposal = await capturedProposal();
    const reviewed = structuredClone(proposal);
    const authorization =
      Promise.withResolvers<
        Awaited<ReturnType<typeof workspaceActorFromPrincipal>>
      >();
    mocks.actor.mockReturnValueOnce(authorization.promise);
    const completion = contactTool().execute(proposal, execution);
    proposal.destination.botId = bots.replacement.id;
    proposal.destination.workspaceId = bots.replacement.workspace_id;
    proposal.text = "Caller mutation after execution began";
    authorization.resolve(actor);
    await completion;
    expect(mocks.open).toHaveBeenCalledWith(
      actor,
      reviewed.username,
      true,
      reviewed.destination
    );
    expect(mocks.send).toHaveBeenCalledWith(
      actor,
      {
        id: conversation.id,
        text: reviewed.text,
        operationId: workspaceOperationId(
          execution.session.id,
          execution.callId
        ),
      },
      reviewed.destination
    );
  });
  it.each(["handle", "workspace", "revision"])(
    "rejects changed %s before opening, receipt creation or sends",
    async (change) => {
      const proposal = await capturedProposal();
      if (change === "handle") currentBot = { ...bots.replacement };
      if (change === "workspace")
        currentBot.workspace_id = "synthetic-destination-reassigned";
      if (change === "revision") currentBot.updated_at = "1790769600000002";
      await expect(contactTool().execute(proposal, execution)).rejects.toThrow(
        "network recipient changed"
      );
      expect(assertNoEgress()).toEqual({
        opened: 0,
        sent: 0,
        results: 0,
        providerRequests: 0,
        botProvisioning: 0,
        userProvisioning: 0,
        writes: [],
      });
    }
  );
  it("rechecks current trust after approval and rejects a blocked recipient", async () => {
    const proposal = await capturedProposal();
    blocked = true;
    await expect(contactTool().execute(proposal, execution)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rejects source membership revocation before any recipient query or opening", async () => {
    const proposal = await capturedProposal();
    mocks.query.mockClear();
    mocks.actor.mockRejectedValue(new WorkspaceAccessDenied());
    await expect(contactTool().execute(proposal, execution)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("grant opening repeats identity validation before any grant or room side effect", async () => {
    const proposal = await capturedProposal();
    currentBot = { ...bots.replacement };
    await expect(
      openNetworkBot(actor, proposal.username, true, proposal.destination)
    ).rejects.toThrow("network recipient changed");
    await expect(
      matrix.openMatrixConversation(
        actor,
        proposal.username,
        true,
        proposal.destination
      )
    ).rejects.toThrow("network recipient changed");
    expect(writes()).toEqual([]);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.ensureBot).not.toHaveBeenCalled();
    expect(mocks.ensureIdentity).not.toHaveBeenCalled();
  });
  it("checks the current destination grant before room provisioning even for an existing grant", async () => {
    const proposal = await capturedProposal();
    const resolveQuery = mocks.query.getMockImplementation();
    if (!resolveQuery)
      throw new Error("The synthetic SQL resolver is required.");
    mocks.query.mockImplementation(async (statement) => {
      const query = dialect.sqlToQuery(statement);
      if (
        query.sql.includes("SELECT id FROM workspace_bots WHERE id") ||
        (query.sql.includes("FROM workspace_agent_grants") &&
          query.sql.includes("FOR UPDATE"))
      )
        return [{ id: conversation.grantId }];
      return resolveQuery(statement);
    });
    mocks.access.mockImplementation(async (subject) => {
      if (subject.agentGrantId) throw new WorkspaceAccessDenied();
      return actor;
    });
    await expect(
      matrix.openMatrixConversation(
        actor,
        proposal.username,
        false,
        proposal.destination
      )
    ).rejects.toThrow(WorkspaceAccessDenied);
    expect(mocks.access).toHaveBeenCalledWith({
      userId: conversation.issuedBy,
      workspaceId: conversation.destWorkspaceId,
      agentGrantId: conversation.grantId,
    });
    expect(writes()).toEqual([]);
    expect(mocks.ensureBot).not.toHaveBeenCalled();
    expect(mocks.ensureIdentity).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("publication rejects a revision changed after room opening before receipt insertion or PUT", async () => {
    const proposal = await capturedProposal();
    currentBot.updated_at = "1790769600000002";
    await expect(
      matrix.sendMatrixConversation(
        actor,
        {
          id: conversation.id,
          operationId: workspaceOperationId(
            execution.session.id,
            execution.callId
          ),
          text: proposal.text,
        },
        proposal.destination
      )
    ).rejects.toThrow("network recipient changed");
    expect(writes()).toEqual([]);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("requires a discovered destination and refuses undisplayable escaped text before approval", async () => {
    const proposal = await capturedProposal();
    expect(
      NetworkContactInputSchema.safeParse({
        username: proposal.username,
        text: proposal.text,
      }).success
    ).toBe(false);
    expect(
      NetworkContactInputSchema.safeParse({
        ...proposal,
        text: "x" + "\u0000".repeat(7999),
      }).success
    ).toBe(false);
    expect(
      NetworkContactInputSchema.safeParse({
        ...proposal,
        text: "x".repeat(8000),
      }).success
    ).toBe(true);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("canonical rendering preserves exact recipient and text even beside misleading supplementary prose", async () => {
    const proposal = await capturedProposal();
    const rendered = renderNetworkApproval(
      proposal,
      "Just a harmless read; no one will receive this."
    );
    expect(rendered).toContain(JSON.stringify(proposal, null, 2));
    expect(rendered).toContain(proposal.destination.botId);
    expect(rendered).toContain(proposal.destination.workspaceId);
    expect(rendered).toContain(proposal.destination.revision);
    expect(rendered).toContain(
      "Supplementary context (does not change the payload)"
    );
  });
});

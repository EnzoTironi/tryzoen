import type { RouteHandlerArgs, Session } from "eve/channels";
import { beforeEach, expect, it, vi } from "vitest";
import channel from "@agent/channels/ideas";
import * as Workspace from "../../../server/workspaces/session";
import { WorkspaceAccessDenied } from "../../../server/workspaces/access";
import * as Ideas from "@db/services/ideas";
import * as Delivery from "@agent/lib/durable-delivery";
import * as Chats from "@db/services/chats";

const id = "00000000-0000-4000-8000-000000000001";
const actor = {
  userId: "alice",
  workspaceId: "personal:alice",
  authSessionId: "current-auth",
  role: "owner",
  organizationId: null,
};
const idea = {
  id,
  userId: "alice",
  workspaceId: "personal:alice",
  key: "reading",
  proposal: {
    key: "reading",
    title: "Reading",
    description: "Read daily",
    rationale: "You enjoy books",
    category: "Learning" as const,
    emoji: "📚",
    prompt: "Make a reading plan",
  },
  status: "starting" as const,
  feedback: null,
  sessionId: null,
  statusEventId: null,
  startAuthSessionId: "original-auth",
  createdAt: new Date(),
  statusAt: new Date(),
};
const session = {
  id: "idea-session",
  cancel: vi.fn<Session["cancel"]>(),
  clear: vi.fn<Session["clear"]>(),
  compact: vi.fn<Session["compact"]>(),
  getEventStream: vi.fn<Session["getEventStream"]>(),
  getStreamTailIndex: vi.fn<Session["getStreamTailIndex"]>(),
  reset: vi.fn<Session["reset"]>(),
  respond: vi.fn<Session["respond"]>(),
  send: vi.fn<Session["send"]>(),
} satisfies Session;
const context = {
  attachSession: vi.fn<RouteHandlerArgs["attachSession"]>(),
  from: vi.fn<RouteHandlerArgs["from"]>(),
  params: { ideaId: id },
  requestIp: null,
  resolveSession: vi.fn<RouteHandlerArgs["resolveSession"]>(),
  to: vi.fn<RouteHandlerArgs["to"]>(),
  waitUntil: vi.fn<RouteHandlerArgs["waitUntil"]>(),
} satisfies RouteHandlerArgs;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Workspace, "resolveWorkspaceActor").mockResolvedValue(actor);
  vi.spyOn(Ideas, "acceptPersonalIdea").mockResolvedValue(idea);
  vi.spyOn(Delivery, "sendDurableMessage").mockResolvedValue(session);
  vi.spyOn(Chats, "saveChat").mockResolvedValue(undefined);
});

async function start(
  headers: HeadersInit = { "content-type": "application/json" }
) {
  const route = channel.routes[0];
  if (!route || route.transport === "websocket")
    throw new Error("Start route missing");
  return route.handler(
    new Request(`https://example.com/companion/ideas/${id}/start`, {
      method: "POST",
      headers,
      body: "{}",
    }),
    context
  );
}

it("uses the same accepted receipt, prompt and authorization when recovering a failed handoff", async () => {
  vi.mocked(Delivery.sendDurableMessage).mockRejectedValueOnce(
    new Error("Connection dropped")
  );
  expect((await start()).status).toBe(503);
  const recovered = await start();
  expect(await recovered.json()).toEqual({ sessionId: "idea-session" });
  const call = vi.mocked(Delivery.sendDurableMessage).mock.calls[1];
  expect(call?.slice(0, 4)).toEqual([
    context,
    `idea:${id}`,
    `idea:${id}`,
    idea.proposal.prompt,
  ]);
  expect(call?.[4].auth?.attributes.authSessionId).toBe("original-auth");
  expect(call?.[4].auth?.attributes.ideaId).toBe(id);
  expect(vi.mocked(Delivery.sendDurableMessage).mock.calls[0]).toEqual(
    vi.mocked(Delivery.sendDurableMessage).mock.calls[1]
  );
});

it("returns an existing conversation without executing again", async () => {
  vi.mocked(Ideas.acceptPersonalIdea).mockResolvedValue({
    ...idea,
    status: "finished",
    sessionId: "already-started",
  });
  expect(await (await start()).json()).toEqual({
    sessionId: "already-started",
  });
  expect(Delivery.sendDurableMessage).not.toHaveBeenCalled();
});

it("authenticates before reading private proposals or starting work", async () => {
  vi.mocked(Workspace.resolveWorkspaceActor).mockRejectedValue(
    new WorkspaceAccessDenied()
  );
  expect((await start()).status).toBe(403);
  expect(Ideas.acceptPersonalIdea).not.toHaveBeenCalled();
  expect(Delivery.sendDurableMessage).not.toHaveBeenCalled();
});

it("rejects cross-site and ordinary form submissions", async () => {
  expect(
    (
      await start({
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      })
    ).status
  ).toBe(403);
  expect((await start({ "content-type": "text/plain" })).status).toBe(403);
  expect(Ideas.acceptPersonalIdea).not.toHaveBeenCalled();
});

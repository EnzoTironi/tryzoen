import { expect, test, vi } from "vitest";
import type { MemoryScopeContext } from "eve/memory";
import archive from "../../../agent/memory/session-sources";

vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: { ...actual.env, ZOEN_SESSION_ARCHIVE_DIR: "/synthetic/archive" },
  };
});

test("the accepted transcript slot admits private authenticated sessions and excludes multiplayer and delegated callers", () => {
  const principal = {
    principalId: "better-auth:synthetic-user",
    principalType: "user",
    authenticator: "authjs",
    attributes: { workspaceId: "personal:synthetic-user" },
  };
  const context = {
    session: {
      id: "synthetic-session",
      auth: { current: principal, initiator: principal },
    },
    channel: {},
    abortSignal: new AbortController().signal,
  } satisfies MemoryScopeContext;
  expect(archive.scope(context)).toEqual([
    "synthetic-session",
    "better-auth:synthetic-user",
  ]);
  const denied: MemoryScopeContext["session"]["auth"]["current"][] = [
    null,
    { ...principal, authenticator: "a2a" },
    { ...principal, authenticator: "untrusted" },
    { ...principal, principalType: "service" },
    { ...principal, attributes: { chatKind: "group" } },
    { ...principal, attributes: { conversationScope: "group:matrix:room" } },
    { ...principal, attributes: { groupBindingId: "binding" } },
    { ...principal, attributes: { agentGrantId: "grant" } },
  ];
  for (const current of denied) {
    expect(
      archive.scope({
        ...context,
        session: {
          ...context.session,
          auth: { ...context.session.auth, current },
        },
      })
    ).toBeNull();
  }
});

import { expect, test } from "vitest";
import {
  applyMobileLocation,
  backMobileNavigation,
  initialMobileNavigation,
  mobileLinkForAccount,
  mobileLinkMessage,
  openMobileConversation,
  parseMobileContentLink,
  reconcileMobileLink,
  acceptsMobileStartupLink,
  mobileLinkDisposition,
} from "./routes";

const origin = "https://app.tryzoen.com";
const parse = (url: string) => parseMobileContentLink(url, origin);

test("personal session and section locators use only the configured origin or declared content scheme", () => {
  for (const url of [
    origin + "/companion/session_123",
    "zoen://companion/session_123",
    "zoen:///companion/session_123",
  ])
    expect(parse(url)).toEqual({
      kind: "location",
      location: { kind: "session", id: "session_123" },
    });
  for (const section of [
    "chat",
    "search",
    "feed",
    "ideas",
    "goals",
    "library",
    "discover",
    "settings",
  ])
    expect(parse("zoen://companion?view=" + section)).toEqual({
      kind: "location",
      location: { kind: "section", section },
    });
  expect(parse(origin + "/companion/")).toEqual({
    kind: "location",
    location: { kind: "section", section: "chat" },
  });
  expect(
    parseMobileContentLink(
      "http://127.0.0.1:4317/companion/session_123",
      "http://127.0.0.1:4317"
    )
  ).toMatchObject({ kind: "location" });
  expect(
    parseMobileContentLink(
      "http://127.0.0.1:4318/companion/session_123",
      "http://127.0.0.1:4317"
    )
  ).toEqual({ kind: "ignored" });
});

test("external links and OAuth callbacks are ignored without inspecting or retaining their payload", () => {
  for (const url of [
    "https://external.example/a/../b",
    "zoen://?cookie=A\\B",
    "https://external.example/companion/session",
    "https://app.tryzoen.com.evil.example/companion/session",
    "https://app.tryzoen.com:444/companion/session",
    "file:///companion/session",
    "javascript:alert(1)",
    "zoen://?cookie=callback-payload",
    "zoen:///auth/callback?cookie=callback-payload",
    origin + "/api/auth/callback/google?cookie=callback-payload",
    "zoen://other/companion/session",
  ]) {
    const result = parse(url);
    expect(result).toEqual({ kind: "ignored" });
    expect(JSON.stringify(result)).not.toContain("callback-payload");
  }
});

test("explicit workspace, room and message scope never falls back to a personal route", () => {
  for (const query of [
    "space=company",
    "room=19cdb11a-2a1e-4f87-9508-cb379b63460c",
    "message=%24opaque",
    "room=19cdb11a-2a1e-4f87-9508-cb379b63460c&space=company&message=%24opaque",
    "space=",
  ]) {
    expect(parse("zoen://companion?" + query)).toEqual({ kind: "unavailable" });
    expect(parse(origin + "/companion/session?" + query)).toEqual({
      kind: "unavailable",
    });
  }
  expect(mobileLinkMessage({ kind: "unavailable" })).toContain(
    "not available on mobile"
  );
});

test("ambiguous, credential-bearing, malformed or unsafe content locators cannot navigate", () => {
  for (const url of [
    origin + "/companion?view=goals&view=library",
    origin + "/companion?space=a&space=b",
    origin + "/companion?view=unknown",
    origin + "/companion/session?view=goals",
    origin + "/companion?draft=hidden-command",
    origin + "/companion/session#part",
    origin + "/companion/a/b",
    origin + "/companion/%",
    origin + "/companion/%2F",
    origin + "/other/../companion/session",
    origin + "/companion/%2e",
    origin + "/companion/%2E/session",
    origin + "/companion/.%2e/session",
    origin + "/companion\\session",
    "zoen:/companion/../companion/session",
    origin + "/companion/%5c",
    origin + "/companion/%252f",
    origin + "/companion/%00",
    origin + "/companion/" + "a".repeat(201),
    "https://user:password@app.tryzoen.com/companion/session",
    "zoen://user:password@companion/session",
    "zoen://companion:123/session",
    " " + origin + "/companion/session",
    "not a URL",
    "a".repeat(4097),
  ])
    expect(parse(url)).toEqual({ kind: "invalid" });
});

test("back hides the conversation without discarding its identity, draft or key and exits only at the inbox root", () => {
  const conversation = openMobileConversation(
    initialMobileNavigation(),
    "mine",
    "keep this draft"
  );
  const inbox = backMobileNavigation(conversation);
  expect(inbox?.conversationOpen).toBe(false);
  expect(inbox?.conversation).toBe(conversation.conversation);
  expect(inbox && backMobileNavigation(inbox)).toBeUndefined();
  const library = applyMobileLocation(conversation, {
    kind: "section",
    section: "library",
  });
  expect(backMobileNavigation(library)).toMatchObject({
    section: "chat",
    conversationOpen: false,
  });
  expect(backMobileNavigation(library)?.conversation).toBe(
    conversation.conversation
  );
  expect(
    backMobileNavigation({ ...conversation, roomId: "existing-room" })?.roomId
  ).toBe("existing-room");
});

test("duplicate same-session delivery reopens the existing draft while a new target selects its own conversation", () => {
  const initial = openMobileConversation(
    initialMobileNavigation(),
    "mine",
    "keep this draft"
  );
  const duplicate = applyMobileLocation(
    { ...initial, conversationOpen: false },
    { kind: "session", id: "mine" }
  );
  expect(duplicate.conversation).toBe(initial.conversation);
  expect(duplicate.conversationOpen).toBe(true);
  const next = applyMobileLocation(initial, { kind: "session", id: "another" });
  expect(next.conversation).toEqual({
    id: "another",
    key: initial.conversation.key + 1,
    draft: undefined,
  });
});

test("signed-out locators bind once, stale account delivery is rejected and consumed links never replay", () => {
  const result = parse("zoen://companion/session");
  if (result.kind !== "location") throw new Error("Expected content locator");
  const signedOut = { result };
  expect(reconcileMobileLink(signedOut, undefined)).toBe(signedOut);
  const accountA = reconcileMobileLink(signedOut, "auth-session-a");
  expect(accountA?.accountSessionId).toBe("auth-session-a");
  if (!accountA) throw new Error("Expected bound locator");
  expect(mobileLinkForAccount(accountA, "auth-session-a")).toBe(true);
  expect(mobileLinkForAccount(accountA, "auth-session-b")).toBe(false);
  expect(mobileLinkForAccount(signedOut, "auth-session-a")).toBe(false);
  expect(reconcileMobileLink(accountA, "auth-session-b")).toBeUndefined();
  expect(reconcileMobileLink(accountA, undefined)).toBeUndefined();
  expect(reconcileMobileLink(undefined, "auth-session-a")).toBeUndefined();
});

test("a startup locator may bind at first sign-in but cannot cross a departed account", () => {
  expect(acceptsMobileStartupLink(undefined, undefined)).toBe(true);
  expect(acceptsMobileStartupLink(undefined, "auth-session-a")).toBe(true);
  expect(acceptsMobileStartupLink("auth-session-a", "auth-session-a")).toBe(
    true
  );
  expect(acceptsMobileStartupLink("auth-session-a", undefined)).toBe(false);
  expect(acceptsMobileStartupLink("auth-session-a", "auth-session-b")).toBe(
    false
  );
  expect(
    acceptsMobileStartupLink("auth-session-a", "auth-session-a", true)
  ).toBe(false);
});

test("open overlays defer bound locations and consume Back without changing or closing the editor", () => {
  const link = {
    result: parse("zoen://companion/session"),
    accountSessionId: "auth-session-a",
  };
  if (link.result.kind === "ignored")
    throw new Error("Expected content locator");
  const pending = { ...link, result: link.result };
  expect(mobileLinkDisposition(pending, "auth-session-a", true)).toBe("defer");
  expect(mobileLinkDisposition(pending, "auth-session-a", false)).toBe(
    "handle"
  );
  expect(mobileLinkDisposition(pending, "auth-session-b", true)).toBe(
    "discard"
  );
  expect(
    mobileLinkDisposition(
      { ...pending, accountSessionId: undefined },
      "auth-session-a",
      false
    )
  ).toBe("discard");
  expect(
    mobileLinkDisposition(
      { ...pending, result: { kind: "unavailable" } },
      "auth-session-a",
      true
    )
  ).toBe("handle");
  const current = openMobileConversation(
    initialMobileNavigation(),
    "mine",
    "unsaved"
  );
  expect(backMobileNavigation(current, true)).toBe(current);
  expect(backMobileNavigation(initialMobileNavigation(), true)).toMatchObject({
    conversationOpen: false,
  });
});

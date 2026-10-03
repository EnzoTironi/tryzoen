import {
  Client,
  defaultMessageReducer,
  type MessageStreamEvent,
} from "eve/client";
import { expect, it, vi } from "vitest";
import {
  renderToLocalizedMarkup,
  renderToSourceMarkup,
} from "../../../tests/helpers/companion-i18n";
import { SessionConversation } from "./session-conversation";
import { useSessionAgent } from "./session/use-session-agent";

vi.mock("./session/use-session-agent", () => ({ useSessionAgent: vi.fn() }));
vi.mock("./session/draft", () => ({
  useConversationDraft: () => ({
    draft: { text: "", files: [] },
    saveDraft: vi.fn(),
  }),
}));
vi.mock("./reactions/use-message-reactions", () => ({
  useMessageReactions: () => ({
    query: { data: [], isError: false },
    showMessages: vi.fn(),
    setReaction: vi.fn(),
  }),
}));
vi.mock("./conversation", () => ({
  Conversation: ({ error }: { error?: string }) =>
    error ? <p role="alert">{error}</p> : <p>Ready</p>,
}));

const client = new Client({ host: "http://127.0.0.1:4351" });
const failed = {
  type: "turn.failed",
  meta: { id: "failed", at: "2026-10-03T12:00:00Z" },
  data: {
    turnId: "turn_0",
    sequence: 0,
    code: "MODEL_CALL_FAILED",
    message: "PRIVATE_PROVIDER_DETAIL",
    details: { credential: "PRIVATE_CREDENTIAL_DETAIL" },
  },
} satisfies MessageStreamEvent;
const waiting = {
  type: "session.waiting",
  meta: { id: "waiting", at: "2026-10-03T12:00:01Z" },
  data: { continuationToken: "session", wait: "next-user-message" },
} satisfies MessageStreamEvent;

function conversation(events: readonly MessageStreamEvent[]) {
  vi.mocked(useSessionAgent).mockReturnValue({
    data: defaultMessageReducer().initial(),
    events,
    status: "ready",
    hasOlder: false,
    isLoadingOlder: false,
    cancel: vi.fn(),
    loadOlder: async () => undefined,
    respond: async () => undefined,
    resume: async () => undefined,
    send: async () => undefined,
  });
  return (
    <SessionConversation
      sessionId="session"
      client={client}
      cacheScope="synthetic-owner"
      reactions={{
        read: async () => [],
        set: async ({ messageId, emoji }) => ({ messageId, emoji }),
      }}
    />
  );
}

it("shows a safe actionable error for a failed response after history replay", () => {
  const html = renderToSourceMarkup(conversation([failed, waiting]));
  expect(html).toContain('role="alert"');
  expect(html).toContain("Send another message to try again.");
  expect(html).not.toContain("PRIVATE_");
});

it("localizes the failed response rather than displaying provider diagnostics", () => {
  const html = renderToLocalizedMarkup(
    conversation([failed, waiting]),
    "pt-BR"
  );
  expect(html).toContain("Envie outra mensagem para tentar novamente.");
  expect(html).not.toContain("PRIVATE_");
});

it("removes the old error when a new native turn starts", () => {
  const next = {
    type: "turn.started",
    meta: { id: "next", at: "2026-10-03T12:00:02Z" },
    data: { turnId: "turn_1", sequence: 1 },
  } satisfies MessageStreamEvent;
  const html = renderToSourceMarkup(conversation([failed, waiting, next]));
  expect(html).not.toContain('role="alert"');
});

it("directs a terminal conversation failure to a new conversation", () => {
  const terminal = {
    type: "session.failed",
    meta: { id: "terminal", at: "2026-10-03T12:00:02Z" },
    data: { sessionId: "session", code: "FAILED", message: "PRIVATE_DETAIL" },
  } satisfies MessageStreamEvent;
  const html = renderToSourceMarkup(conversation([terminal]));
  expect(html).toContain("Start a new conversation to continue.");
  expect(html).not.toContain("PRIVATE_");
});

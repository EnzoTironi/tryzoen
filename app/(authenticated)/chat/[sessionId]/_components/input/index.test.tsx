import type { ComponentProps, ReactNode } from "react";
import type { MessageStreamEvent } from "eve/client";
import type { PromptInputMessage } from "@web/components/ai-elements/prompt-input";
import { renderToEnglishMarkup } from "@tests/helpers/i18n";
import { beforeEach, expect, it, vi } from "vitest";
import type { ChatAgent } from "../chat-agent";

const mocks = vi.hoisted(() => ({
  submit:
    vi.fn<(callback: (message: PromptInputMessage) => Promise<void>) => void>(),
  save: vi.fn<(input: { sessionId: string }) => void>(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("space=company-space"),
}));
vi.mock("@web/trpc/client", () => ({
  api: { chats: { save: { useMutation: () => ({ mutate: mocks.save }) } } },
}));
vi.mock("@web/components/ai-elements/prompt-input", () => ({
  PromptInput: ({
    children,
    onSubmit,
  }: {
    children: ReactNode;
    onSubmit: (message: PromptInputMessage) => Promise<void>;
  }) => {
    mocks.submit(onSubmit);
    return <form>{children}</form>;
  },
  PromptInputBody: ({ children }: { children: ReactNode }) => children,
  PromptInputFooter: ({ children }: { children: ReactNode }) => children,
  PromptInputTools: () => null,
  PromptInputTextarea: (props: ComponentProps<"textarea">) => (
    <textarea {...props} />
  ),
  PromptInputSubmit: () => <button type="submit">Send</button>,
}));

import { ChatInput } from ".";

beforeEach(() => vi.clearAllMocks());

it.each([
  {
    type: "session.completed",
    meta: { id: "done", at: "2026-09-20T00:00:00.000Z" },
  },
  {
    type: "session.failed",
    data: {
      code: "MODEL_CALL_FAILED",
      message: "Model unavailable",
      sessionId: "terminal-session",
    },
    meta: { id: "failed", at: "2026-09-20T00:00:00.000Z" },
  },
] satisfies MessageStreamEvent[])(
  "offers a workspace-preserving new chat and retains an editable draft after $type",
  async (terminal) => {
    const agent = {
      cancel: vi.fn<ChatAgent["cancel"]>(),
      send: vi.fn<ChatAgent["send"]>(),
      data: { messages: [] },
      events: [terminal],
      status: "ready",
    } satisfies ComponentProps<typeof ChatInput>["agent"];
    const markup = renderToEnglishMarkup(
      <ChatInput agent={agent} sessionId="terminal-session" />
    );
    expect(markup).toContain('href="/chat?space=company-space"');
    expect(markup).toContain("New chat");
    expect(markup).toContain("<textarea");
    expect(markup).not.toMatch(/<textarea[^>]*\sdisabled(?:[=>\s])/u);
    expect(markup).not.toContain('type="submit"');
    const submit = mocks.submit.mock.calls[0]?.[0];
    if (!submit) throw new Error("Missing composer submit handler.");
    await expect(
      submit({ text: "Keep this editable draft", files: [] })
    ).rejects.toThrow("conversation has ended");
    expect(agent.send).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  }
);

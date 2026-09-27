import type { useEveAgent } from "eve/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedCompanion } from "@app/companion/connected";

type AgentOptions = Parameters<typeof useEveAgent>[0];

const mocks = vi.hoisted(() => ({
  send: vi.fn<(text: string, options?: unknown) => Promise<void>>(),
  save: vi.fn<
    (input: { sessionId: string; title?: string }) => Promise<void>
  >(),
  replace: vi.fn<(path: string) => void>(),
  options: undefined as AgentOptions | undefined,
  submit: undefined as ((text: string) => Promise<void>) | undefined,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams("space=team-test"),
}));
vi.mock("eve/react", () => ({
  useEveAgent: (options: AgentOptions) => {
    mocks.options = options;
    return { send: mocks.send, status: "ready", data: { messages: [] } };
  },
}));
vi.mock("@web/trpc/client", () => ({
  api: {
    chats: { save: { useMutation: () => ({ mutateAsync: mocks.save }) } },
  },
}));
vi.mock(
  "@app/(authenticated)/chat/[sessionId]/_components/use-session-agent",
  () => ({
    useSessionAgent: () => {
      throw new Error("New conversations must not attach an existing session.");
    },
  })
);
vi.mock("@zoen/companion-ui", () => ({
  CompanionShell: ({ children }: { children: ReactNode }) => children,
  Welcome: ({ onSend }: { onSend: (text: string) => Promise<void> }) => {
    mocks.submit = onSend;
    return <div>Welcome</div>;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue(undefined);
  mocks.options = undefined;
  mocks.submit = undefined;
});

describe("companion conversation handoff", () => {
  it("does not send or create history until the user submits", () => {
    expect(renderToStaticMarkup(<ConnectedCompanion />)).toContain("Welcome");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects a callback-only send failure so the composer preserves the draft", async () => {
    renderToStaticMarkup(<ConnectedCompanion />);
    const failure = new Error("Connection lost");
    mocks.send.mockImplementation(() => {
      mocks.options?.onError?.(failure);
      return Promise.resolve();
    });
    await expect(mocks.submit?.("Keep this draft")).rejects.toThrow(failure);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves and opens a new session once while preserving workspace selection", async () => {
    renderToStaticMarkup(<ConnectedCompanion />);
    await mocks.submit?.("Plan tomorrow");
    mocks.options?.onSessionChange?.({
      sessionId: "session/one",
      streamIndex: 0,
    });
    mocks.options?.onSessionChange?.({
      sessionId: "session/one",
      streamIndex: 1,
    });
    await vi.waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
        "/companion/session%2Fone?space=team-test"
      );
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      sessionId: "session/one",
      title: "Plan tomorrow",
    });
  });
});

import type { ReactNode, ComponentProps } from "react";
import type { NewConversation } from "@zoen/companion-ui";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ConnectedCompanion } from "@app/companion/connected";
const mocks = vi.hoisted(() => ({
  replace: vi.fn<(path: string) => void>(),
  save: vi.fn<(input: { sessionId: string; title: string }) => Promise<void>>(),
  conversation: undefined as ComponentProps<typeof NewConversation> | undefined,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams("space=team-test"),
}));
vi.mock("@web/trpc/client", () => ({
  api: {
    chats: { save: { useMutation: () => ({ mutateAsync: mocks.save }) } },
  },
}));
vi.mock("@zoen/companion-ui", () => ({
  CompanionShell: ({ children }: { children: ReactNode }) => children,
  NewConversation: (props: ComponentProps<typeof NewConversation>) => {
    mocks.conversation = props;
    return <div>Welcome</div>;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue(undefined);
});
it("opens saved conversations without losing the selected workspace", async () => {
  expect(renderToStaticMarkup(<ConnectedCompanion />)).toContain("Welcome");
  await mocks.conversation?.save("session/one", "Plan tomorrow");
  mocks.conversation?.onCreated("session/one");
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
    sessionId: "session/one",
    title: "Plan tomorrow",
  });
  expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
    "/companion/session%2Fone?space=team-test"
  );
});

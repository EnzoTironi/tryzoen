import type { ReactNode, ComponentProps } from "react";
import type {
  NewConversation,
  RoomConversation,
  useDarkAppearance,
} from "@zoen/companion-ui";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ConnectedCompanion } from "@app/companion/connected";
const mocks = vi.hoisted(() => ({
  replace: vi.fn<(path: string) => void>(),
  save: vi.fn<(input: { sessionId: string; title: string }) => Promise<void>>(),
  conversation: undefined as ComponentProps<typeof NewConversation> | undefined,
  room: undefined as ComponentProps<typeof RoomConversation> | undefined,
  search: "space=team-test",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@web/trpc/client", () => ({
  api: {
    useUtils: () => ({ client: {} }),
    chats: { save: { useMutation: () => ({ mutateAsync: mocks.save }) } },
  },
}));
vi.mock("@trpc/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@trpc/client")>()),
  getUntypedClient: () => ({
    query: vi.fn<() => Promise<unknown>>(),
    mutation: vi.fn<() => Promise<unknown>>(),
  }),
}));
vi.mock("@zoen/companion-ui", async () => ({
  useDarkAppearance: vi.fn<typeof useDarkAppearance>().mockReturnValue(false),
  parseRoomMessageLocation: (
    await import("../packages/companion-ui/src/rooms/links")
  ).parseRoomMessageLocation,
  RoomConversation: (props: ComponentProps<typeof RoomConversation>) => {
    mocks.room = props;
    return <div>Room</div>;
  },
  GesturePreferenceProvider: ({ children }: { children: ReactNode }) =>
    children,
  CompanionShell: ({ children }: { children: ReactNode }) => children,
  ComposerReferenceProvider: ({ children }: { children: ReactNode }) =>
    children,
  AttachmentProvider: ({ children }: { children: ReactNode }) => children,
  MarkdownEditorProvider: ({ children }: { children: ReactNode }) => children,
  ComposerEditorProvider: ({ children }: { children: ReactNode }) => children,
  LinkPreviewProvider: ({ children }: { children: ReactNode }) => children,
  CompanionOverlayProvider: ({ children }: { children: ReactNode }) => children,
  NewConversation: (props: ComponentProps<typeof NewConversation>) => {
    mocks.conversation = props;
    return <div>Welcome</div>;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue(undefined);
  mocks.search = "space=team-test";
  mocks.room = undefined;
});
it("opens the exact linked message and keeps malformed references out of the context reader", () => {
  mocks.search =
    "space=team-test&room=19cdb11a-2a1e-4f87-9508-cb379b63460c&message=%24original";
  expect(
    renderToStaticMarkup(<ConnectedCompanion draftScope="test/team" />)
  ).toContain("Room");
  expect(mocks.room?.selectedMessage).toBe("$original");
  mocks.search += "&message=%24another";
  expect(
    renderToStaticMarkup(<ConnectedCompanion draftScope="test/team" />)
  ).toContain("Este link de mensagem é inválido.");
  expect(mocks.room?.selectedMessage).toBeUndefined();
});
it("opens saved conversations without losing the selected workspace", async () => {
  expect(
    renderToStaticMarkup(<ConnectedCompanion draftScope="test/team" />)
  ).toContain("Welcome");
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

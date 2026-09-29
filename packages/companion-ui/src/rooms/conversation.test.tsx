import { renderToStaticMarkup } from "react-dom/server";
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
  type useInfiniteQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RoomConversation } from "./conversation";
import type { RoomData } from "./schema";

vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("../markdown", () => ({
  AssistantMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}));
const mocks = vi.hoisted(() => ({
  revoked: false,
  direct: false,
  options: undefined as Parameters<typeof useInfiniteQuery>[0] | undefined,
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useInfiniteQuery: (options: Parameters<typeof useInfiniteQuery>[0]) => {
    mocks.options = options;
    return {
      isPending: false,
      isError: mocks.revoked,
      error: mocks.revoked ? new Error("Access revoked") : null,
      data: {
        pages: [
          {
            room: {
              label: mocks.direct ? "Ana" : "Shared room",
              kind: mocks.direct ? "direct" : "group",
              username: mocks.direct ? "ana" : undefined,
            },
            members: [],
            messages: [
              {
                id: "$message",
                text: "Synthetic private text",
                sender: "Member",
                senderId: "@member:test",
                bot: false,
                mine: false,
                timestamp: 0,
                rootId: null,
                replies: 0,
                reply: null,
              },
            ],
          },
        ],
      },
    };
  },
  useQuery: () => ({
    data: [
      {
        messageId: "$message",
        mine: null,
        mineEventId: null,
        complete: true,
        reactions: [{ emoji: "❤️", count: 2 }],
      },
    ],
  }),
}));
const data: RoomData = {
  setTyping: vi.fn<RoomData["setTyping"]>(),
  readSync: vi.fn<RoomData["readSync"]>(),
  search: vi.fn<RoomData["search"]>(),
  markRead: vi.fn<RoomData["markRead"]>(),
  savedCleanupState: vi.fn<RoomData["savedCleanupState"]>(),
  clearUnavailableSavedMessages:
    vi.fn<RoomData["clearUnavailableSavedMessages"]>(),
  savedMessageState: vi.fn<RoomData["savedMessageState"]>(),
  savedMessages: vi.fn<RoomData["savedMessages"]>(),
  saveMessage: vi.fn<RoomData["saveMessage"]>(),
  context: vi.fn<RoomData["context"]>(),
  editMessage: vi.fn<RoomData["editMessage"]>(),
  deleteMessage: vi.fn<RoomData["deleteMessage"]>(),
  forwardDestinations: vi.fn<RoomData["forwardDestinations"]>(),
  forwardMessage: vi.fn<RoomData["forwardMessage"]>(),
  people: vi.fn<RoomData["people"]>(),
  openDirect: vi.fn<RoomData["openDirect"]>(),
  directs: vi.fn<RoomData["directs"]>(),
  media: vi.fn<RoomData["media"]>(),
  operationId: vi.fn<RoomData["operationId"]>(),
  messages: vi.fn<RoomData["messages"]>(),
  thread: vi.fn<RoomData["thread"]>(),
  reactions: vi.fn<RoomData["reactions"]>(),
  react: vi.fn<RoomData["react"]>(),
  list: vi.fn<RoomData["list"]>(),
  send: vi.fn<RoomData["send"]>(),
  create: vi.fn<RoomData["create"]>(),
};
beforeEach(() => {
  mocks.revoked = false;
  mocks.direct = false;
});
function render() {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RoomConversation
        data={data}
        cacheScope="viewer"
        roomId="binding"
        onBack={vi.fn<() => void>()}
        onCopyText={vi.fn<(text: string) => Promise<void>>()}
      />
    </QueryClientProvider>
  );
}
it("renders native reaction counts, profile links and the same message actions in the shared timeline", () => {
  const html = render();
  expect(html).toContain("Synthetic private text");
  expect(html).toContain("❤️: 2 reações");
  expect(html).toContain("Copy message");
  expect(html).toContain("Reply to message");
  expect(html).toContain("Perfil de Member");
});
it("hides cached messages and reactions once room authorization fails", () => {
  mocks.revoked = true;
  const html = render();
  expect(html).not.toContain("Synthetic private text");
  expect(html).not.toContain("❤️");
  expect(html).toContain('role="alert"');
});

it("renders direct conversation identity without group or agent participation copy", () => {
  mocks.direct = true;
  const html = render();
  expect(html).toContain("@ana · conversa direta");
  expect(html).toContain("Perfil da pessoa");
  expect(html).toContain("Mensagem direta");
  expect(html).not.toContain("Pessoas e Zoen");
  expect(html).not.toContain("Detalhes do grupo");
});

const historyClient = new QueryClient();
afterEach(() => {
  historyClient.clear();
  vi.mocked(data.messages).mockReset();
});

it("loads more than five cursor pages and stops at the end of the room history", async () => {
  vi.mocked(data.messages).mockImplementation(async ({ from }) => {
    const page = Number(from ?? 0);
    return {
      room: {
        id: "binding",
        roomId: "!room:test",
        label: "Test",
        kind: "group",
        epoch: "1",
      },
      members: [],
      membersTruncated: false,
      messages: [],
      nextCursor: page < 6 ? String(page + 1) : null,
    };
  });
  render();
  if (!mocks.options) throw new Error("Expected room query options");
  const observer = new InfiniteQueryObserver(historyClient, {
    ...mocks.options,
    enabled: false,
    retry: false,
    refetchInterval: false,
  });
  await observer.refetch();
  for (let index = 0; index < 6; index += 1)
    await observer.fetchNextPage({ cancelRefetch: false });
  expect(observer.getCurrentResult().data?.pages).toHaveLength(7);
  expect(observer.getCurrentResult().hasNextPage).toBe(false);
  await observer.fetchNextPage({ cancelRefetch: false });
  expect(data.messages).toHaveBeenCalledTimes(7);
  expect(data.messages).toHaveBeenLastCalledWith(
    { id: "binding", from: "6" },
    expect.any(AbortSignal)
  );
});

it("coalesces simultaneous history requests and stops a repeated cursor", async () => {
  vi.mocked(data.messages).mockImplementation(async () => ({
    room: {
      id: "binding",
      roomId: "!room:test",
      label: "Test",
      kind: "group",
      epoch: "1",
    },
    members: [],
    membersTruncated: false,
    messages: [],
    nextCursor: "same",
  }));
  render();
  if (!mocks.options) throw new Error("Expected room query options");
  const observer = new InfiniteQueryObserver(historyClient, {
    ...mocks.options,
    enabled: false,
    retry: false,
    refetchInterval: false,
  });
  await observer.refetch();
  await Promise.all([
    observer.fetchNextPage({ cancelRefetch: false }),
    observer.fetchNextPage({ cancelRefetch: false }),
  ]);
  expect(data.messages).toHaveBeenCalledTimes(2);
  expect(observer.getCurrentResult().hasNextPage).toBe(false);
});

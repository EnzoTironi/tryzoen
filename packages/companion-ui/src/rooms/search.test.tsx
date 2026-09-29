import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi, beforeEach } from "vitest";
import {
  type useInfiniteQuery,
  QueryClient,
  QueryClientProvider,
  InfiniteQueryObserver,
} from "@tanstack/react-query";
import { RoomSearch } from "./search";
import type { RoomData } from "./schema";
vi.mock("../sheet", () => ({
  CompanionSheet: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("../markdown", () => ({
  AssistantMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}));
const mocks = vi.hoisted(() => ({
  failed: false,
  options: undefined as Parameters<typeof useInfiniteQuery>[0] | undefined,
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useInfiniteQuery: (options: Parameters<typeof useInfiniteQuery>[0]) => {
    mocks.options = options;
    return {
      isError: mocks.failed,
      data: {
        pages: [
          {
            items: [
              {
                id: "$id",
                text: "Current authorized search text",
                sender: "Ana",
                mine: false,
                timestamp: 1,
              },
            ],
          },
        ],
      },
      hasNextPage: false,
      isFetching: false,
    };
  },
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
  mocks.failed = false;
  data.search = vi
    .fn<RoomData["search"]>()
    .mockResolvedValue({ items: [], nextCursor: null });
});
function render(scope = "viewer:session") {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RoomSearch
        data={data}
        cacheScope={scope}
        roomId="room"
        members={[]}
        onClose={vi.fn<() => void>()}
        onOpenRoom={vi.fn<(id: string) => void>()}
      />
    </QueryClientProvider>
  );
}
it("hides cached search content when access fails", () => {
  expect(render()).toContain("Current authorized search text");
  mocks.failed = true;
  const html = render();
  expect(html).not.toContain("Current authorized search text");
  expect(html).toContain("Não foi possível buscar nesta conversa");
});
it("scopes the query to login and room and leaves an empty query disabled", () => {
  render("another:login");
  expect(mocks.options?.queryKey).toEqual([
    "matrix-search",
    "another:login",
    "room",
    "",
    undefined,
  ]);
  expect(mocks.options?.enabled).toBe(false);
  expect(mocks.options?.gcTime).toBe(0);
});
it("passes TanStack cancellation into the room transport", async () => {
  render();
  const options = mocks.options;
  if (!options) throw new Error("Search query was not registered");
  const client = new QueryClient();
  const observer = new InfiniteQueryObserver(client, {
    ...options,
    enabled: true,
  });
  const unsubscribe = observer.subscribe(vi.fn<() => void>());
  await vi.waitFor(() => {
    expect(data.search).toHaveBeenCalled();
  });
  const signal = vi.mocked(data.search).mock.calls[0]?.[1];
  expect(signal).toBeInstanceOf(AbortSignal);
  unsubscribe();
  client.clear();
});

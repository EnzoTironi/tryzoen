import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
  type useInfiniteQuery,
} from "@tanstack/react-query";
import { ForwardRoomMessage } from "./forward-message";
import type { RoomData } from "./schema";
vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("../sheet", () => ({
  CompanionSheet: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../markdown", () => ({
  AssistantMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}));
const capture = vi.hoisted(() => ({
  failed: false,
  options: undefined as Parameters<typeof useInfiniteQuery>[0] | undefined,
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useInfiniteQuery: (options: Parameters<typeof useInfiniteQuery>[0]) => {
    capture.options = options;
    return {
      isError: capture.failed,
      data: {
        pages: [
          {
            items: [
              {
                id: "destination",
                label: "Authorized destination",
                kind: "group",
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
const data: ComponentProps<typeof ForwardRoomMessage>["data"] = {
  media: vi.fn<RoomData["media"]>(),
  operationId: () => "operation",
  forwardMessage: vi.fn<RoomData["forwardMessage"]>(),
  forwardDestinations: vi.fn<RoomData["forwardDestinations"]>(),
};
beforeEach(() => {
  capture.failed = false;
  vi.mocked(data.forwardDestinations).mockReset();
});
function render() {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ForwardRoomMessage
        data={data}
        cacheScope="account:workspace:session"
        roomId="source"
        item={{
          id: "$message",
          senderId: "person",
          sender: "Person",
          text: "Private text",
          mine: false,
          bot: false,
          timestamp: 1,
          replies: 0,
          rootId: null,
          reply: null,
        }}
        onClose={vi.fn<() => void>()}
      />
    </QueryClientProvider>
  );
}
it("never sends or downloads content just by opening the destination picker", () => {
  expect(render()).toContain("Authorized destination");
  expect(data.forwardMessage).not.toHaveBeenCalled();
  expect(data.media).not.toHaveBeenCalled();
  expect(capture.options?.queryKey).toEqual([
    "matrix-forward-destinations",
    "account:workspace:session",
    "source",
    "",
  ]);
});
it("hides cached destinations after authorization fails", () => {
  capture.failed = true;
  expect(render()).not.toContain("Authorized destination");
  expect(render()).toContain("Não foi possível carregar as conversas");
});
it("uses native cancellation and cursor pagination for the destination list", async () => {
  render();
  const options = capture.options;
  if (!options) throw new Error("Missing destination query");
  vi.mocked(data.forwardDestinations)
    .mockResolvedValueOnce({ items: [], nextCursor: "page-two" })
    .mockImplementation(
      () =>
        new Promise(() => {
          /* Hold the transport open until TanStack cancels it. */
        })
    );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const observer = new InfiniteQueryObserver(client, options);
  const stop = observer.subscribe(vi.fn<() => void>());
  await vi.waitFor(() => {
    expect(observer.getCurrentResult().hasNextPage).toBe(true);
  });
  const next = observer.fetchNextPage();
  await vi.waitFor(() => {
    expect(data.forwardDestinations).toHaveBeenCalledTimes(2);
  });
  expect(vi.mocked(data.forwardDestinations).mock.calls[1]?.[0]).toEqual({
    id: "source",
    query: "",
    before: "page-two",
  });
  const signal = vi.mocked(data.forwardDestinations).mock.calls[1]?.[1];
  stop();
  expect(signal.aborted).toBe(true);
  await next;
  client.clear();
});

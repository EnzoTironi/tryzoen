import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { RoomConversation } from "./conversation";
import type { RoomData } from "./schema";

vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("../markdown", () => ({
  AssistantMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}));
const mocks = vi.hoisted(() => ({ revoked: false }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useInfiniteQuery: () => ({
    isPending: false,
    isError: mocks.revoked,
    error: mocks.revoked ? new Error("Access revoked") : null,
    data: {
      pages: [
        {
          room: { label: "Shared room" },
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
  }),
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

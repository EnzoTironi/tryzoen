import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { beforeEach, expect, it, vi } from "vitest";
import type { readMatrixMessages } from "../../../../server/matrix/rooms";
import RoomsPage from "./page";

const mocks = vi.hoisted(() => ({
  messages: vi.fn<
    () => {
      data?: Awaited<ReturnType<typeof readMatrixMessages>>;
      error?: Error;
      isPending: boolean;
    }
  >(),
}));

// Open the room using React's real state hook, without exposing a test-only page export.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) =>
      react.useState(initial === undefined ? "binding" : initial),
  };
});
vi.mock("@web/trpc/client", () => ({
  api: {
    workspaces: {
      rooms: {
        list: { useQuery: () => ({ data: { mayManage: false } }) },
        create: { useMutation: () => ({}) },
        messages: { useQuery: mocks.messages },
        send: { useMutation: () => ({}) },
        close: { useMutation: () => ({}) },
      },
    },
  },
}));

beforeEach(() => {
  mocks.messages.mockReturnValue({
    isPending: false,
    data: {
      room: {
        id: "binding",
        roomId: "!room:matrix.test",
        label: "Team room",
        epoch: "epoch",
        matrixId: "@member:matrix.test",
      },
      messages: [
        {
          id: "$message",
          text: "Zoen, react to this",
          sender: "Member",
          mine: true,
          timestamp: 0,
          reactions: [{ type: "heart", count: 2 }],
        },
      ],
    },
  });
});

it("shows the agent's reaction and count under the original room message", () => {
  const html = renderToStaticMarkup(<RoomsPage />);
  expect(html).toMatch(
    /<article[^>]*>[\s\S]*Zoen, react to this[\s\S]*❤️ 2[\s\S]*<\/article>/u
  );
  expect(html.match(/<article/g)).toHaveLength(1);
  expect(mocks.messages).toHaveBeenCalledWith(
    { id: "binding" },
    { refetchInterval: 3000, retry: false }
  );
});

it("hides stale messages and reactions once room access fails", () => {
  const cached = mocks.messages();
  mocks.messages.mockReturnValue({
    ...cached,
    error: new Error("Access revoked"),
  });
  const html = renderToStaticMarkup(<RoomsPage />);
  expect(html).not.toContain("Zoen, react to this");
  expect(html).not.toContain("❤️");
  expect(html).toContain('role="alert"');
});

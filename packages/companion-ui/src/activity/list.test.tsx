import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import {
  QueryClient,
  QueryClientProvider,
  type useInfiniteQuery,
} from "@tanstack/react-query";
import { AgentActivity } from "./list";
import type { ActivityData } from "./schema";

vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => import("lucide-react"));
const state = vi.hoisted(() => ({
  failed: false,
  options: undefined as Parameters<typeof useInfiniteQuery>[0] | undefined,
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useInfiniteQuery: (options: Parameters<typeof useInfiniteQuery>[0]) => {
    state.options = options;
    return {
      isError: state.failed,
      isPending: false,
      isFetchingNextPage: false,
      isRefetching: false,
      data: {
        pages: [
          {
            items: [
              {
                id: "event-one",
                sessionId: "session-one",
                title: "Private review",
                kind: "approval.settled",
                at: "2026-09-28T12:00:00.123456Z",
              },
            ],
            nextCursor: null,
          },
        ],
      },
    };
  },
}));

beforeEach(() => {
  state.failed = false;
  state.options = undefined;
});

function render(scope: string, approvals = false) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AgentActivity
        data={{ activity: vi.fn<ActivityData["activity"]>() }}
        cacheScope={scope}
        approvals={approvals}
        onSelect={vi.fn<ComponentProps<typeof AgentActivity>["onSelect"]>()}
      />
    </QueryClientProvider>
  );
}

it("shows recorded decisions without inventing an approval outcome and separates scopes", () => {
  const html = render("alice:personal", true);
  expect(html).toContain("Private review");
  expect(html).toContain("Decisão registrada");
  expect(html).not.toContain("Permitido");
  expect(state.options?.queryKey).toEqual([
    "agent-activity",
    "alice:personal",
    true,
  ]);
  render("bob:team");
  expect(state.options?.queryKey).toEqual([
    "agent-activity",
    "bob:team",
    false,
  ]);
});

it("hides previously cached private rows after a failed authorization or history request", () => {
  state.failed = true;
  const html = render("alice:personal");
  expect(html).not.toContain("Private review");
  expect(html).toContain("Não foi possível carregar a atividade");
  expect(html).toContain("Tentar novamente");
});

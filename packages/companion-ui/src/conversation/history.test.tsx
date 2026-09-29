import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, EffectCallback, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { Conversation } from "../conversation";
const mocks = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  list: undefined as
    | undefined
    | {
        onScroll: (event: {
          nativeEvent: {
            contentSize: { height: number };
            contentOffset: { y: number };
            layoutMeasurement: { height: number };
          };
        }) => void;
        onContentSizeChange: () => void;
        onScrollBeginDrag: () => void;
        onLayout: () => void;
        ListHeaderComponent: ReactNode;
      },
  end: vi.fn<() => void>(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: EffectCallback) => {
    mocks.effects.push(effect);
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  StyleSheet: { create: (value: unknown) => value },
  ActivityIndicator: () => <span>Loading</span>,
  FlatList: (
    props: NonNullable<typeof mocks.list> & { ref: { current: unknown } }
  ) => {
    mocks.list = props;
    props.ref.current = {
      scrollToEnd: mocks.end,
      getScrollableNode: () => undefined,
    };
    return <div>{props.ListHeaderComponent}</div>;
  },
}));
vi.mock("../session/input", () => ({ messageContent: () => [] }));
vi.mock("../theme", () => ({ colors: {} }));
vi.mock("lucide-react-native", () => ({
  Puzzle: () => null,
  ShieldCheck: () => null,
}));
vi.mock("../cards/resource", () => ({ ResourceCard: () => null }));
vi.mock("../conversation/input-request", () => ({
  InputRequestCard: () => null,
}));
vi.mock("../cards/link", () => ({
  LinkCard: () => null,
  MessageLinks: () => null,
}));
vi.mock("../markdown", () => ({ AssistantMarkdown: () => null }));
vi.mock("../button", () => ({
  ActionButton: ({ children }: { children: ReactNode }) => (
    <button>{children}</button>
  ),
}));
vi.mock("../composer", () => ({ Composer: () => null }));
vi.mock("../message-actions", () => ({ MessageActions: () => null }));
vi.mock("../attachments/card", () => ({ AttachmentCard: () => null }));
const load = vi.fn<() => Promise<void>>();
function render(extra: Partial<ComponentProps<typeof Conversation>> = {}) {
  const send = vi.fn<ComponentProps<typeof Conversation>["onSend"]>();
  renderToStaticMarkup(
    <Conversation
      messages={[{ id: "latest", role: "user", parts: [] }]}
      status="ready"
      onSend={send}
      onRespond={async () => undefined}
      onCancel={() => undefined}
      onLoadOlder={load}
      {...extra}
    />
  );
  for (const effect of mocks.effects) effect();
}
function scroll(y: number) {
  mocks.list?.onScroll({
    nativeEvent: {
      contentSize: { height: 1200 },
      contentOffset: { y },
      layoutMeasurement: { height: 400 },
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(undefined);
  mocks.effects = [];
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 1;
  });
});
it("initial measurements and follow-bottom do not scan old history", () => {
  render();
  scroll(0);
  scroll(800);
  mocks.list?.onContentSizeChange();
  expect(load).not.toHaveBeenCalled();
  expect(mocks.end).toHaveBeenCalled();
});
it("loads once when intentionally scrolling toward the older edge", () => {
  render();
  scroll(800);
  scroll(200);
  scroll(100);
  scroll(0);
  expect(load).toHaveBeenCalledOnce();
  mocks.end.mockClear();
  mocks.list?.onContentSizeChange();
  expect(mocks.end).not.toHaveBeenCalled();
});
it.each([
  { loadingOlder: true },
  { olderError: "Offline" },
  { onLoadOlder: undefined },
])("does not auto-load when blocked by %j", (extra) => {
  render(extra);
  scroll(800);
  scroll(100);
  expect(load).not.toHaveBeenCalled();
});

it("loads a short page on an intentional native drag without startup scanning", () => {
  render();
  mocks.list?.onLayout();
  expect(load).not.toHaveBeenCalled();
  mocks.list?.onScrollBeginDrag();
  expect(load).toHaveBeenCalledOnce();
});

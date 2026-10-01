import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import type { Pressable } from "react-native";
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
  type useInfiniteQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RoomConversation } from "./conversation";
import { useRoomSync } from "./sync";
import type { useRoomParticipation } from "./participation";
import { RoomMessageContext } from "./context";
import type { RoomData } from "./schema";

vi.mock("react-native", async () => {
  const native =
    await vi.importActual<typeof import("react-native")>("react-native-web");
  return {
    ...native,
    Platform: {
      ...native.Platform,
      get OS() {
        return mocks.platform;
      },
    },
    useColorScheme: () => (mocks.dark ? "dark" : "light"),
    useWindowDimensions: () => ({
      width: mocks.width,
      height: 844,
      scale: 1,
      fontScale: 1,
    }),
    View: (props: ComponentProps<typeof import("react-native").View>) => {
      const style = native.StyleSheet.flatten(props.style);
      if (props.testID === "conversation-header") mocks.header = props;
      if (props.style && style.backdropFilter && style.boxShadow)
        mocks.materials.push(style);
      return <native.View {...props} />;
    },
    Pressable: (props: ComponentProps<typeof Pressable>) => {
      if (props.accessibilityHint) mocks.hints.push(props.accessibilityHint);
      const style = native.StyleSheet.flatten(
        typeof props.style === "function"
          ? props.style({ pressed: false })
          : props.style
      );
      if (props.accessibilityLabel?.startsWith("Detalhes de "))
        mocks.capsule = style;
      return <native.Pressable {...props} />;
    },
  };
});
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("../theme", async (original) => ({
  ...(await original<typeof import("../theme")>()),
  useAccessibilityPreferences: () => mocks.preferences,
}));
vi.mock("react-native-svg", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <svg>{children}</svg>
  ),
  Path: ({ d, fill }: { d: string; fill: string }) => (
    <path d={d} fill={fill} />
  ),
}));
vi.mock("../markdown", () => ({
  AssistantMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}));
vi.mock("./sync", () => ({
  useRoomSync: vi.fn<typeof useRoomSync>(() => ({
    userIds: [],
    presence: [],
    receipts: [],
    reconnecting: false,
    accessDenied: false,
    change: vi.fn<(value: boolean) => void>(),
  })),
}));
vi.mock("./participation", () => ({
  useRoomParticipation: vi.fn<typeof useRoomParticipation>(() => ({
    ready: mocks.participation === "joined",
    revision: 1,
    status: mocks.participation,
    requireJoined: () => {
      if (mocks.participation !== "joined")
        throw new Error("Room participation is not confirmed.");
    },
    cancel: vi.fn<() => void>(),
    retry: vi.fn<() => void>(),
  })),
}));
vi.mock("./context", () => ({
  RoomMessageContext: vi.fn<typeof RoomMessageContext>(() => (
    <p>Message context</p>
  )),
}));
const mocks = vi.hoisted(() => ({
  participation: "joined" as ReturnType<typeof useRoomParticipation>["status"],
  revoked: false,
  width: 1000,
  dark: false,
  platform: "web",
  blurSupported: true,
  preferences: {
    reduceMotion: false,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  },
  materials: [] as Record<string, unknown>[],
  capsule: undefined as Record<string, unknown> | undefined,
  header: undefined as
    | ComponentProps<typeof import("react-native").View>
    | undefined,
  direct: false,
  hints: [] as string[],
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
  useQuery: (options: { queryKey: readonly string[] }) => ({
    data:
      options.queryKey[0] === "matrix-outbox"
        ? []
        : [
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
  participate: vi.fn<RoomData["participate"]>(),
  pins: vi.fn<RoomData["pins"]>(),
  pin: vi.fn<RoomData["pin"]>(),
  reactors: vi.fn<RoomData["reactors"]>(),
  readReceiptPreference: vi.fn<RoomData["readReceiptPreference"]>(),
  setReadReceiptPreference: vi.fn<RoomData["setReadReceiptPreference"]>(),
  presencePreference: vi.fn<RoomData["presencePreference"]>(),
  setPresencePreference: vi.fn<RoomData["setPresencePreference"]>(),
  notifications: vi.fn<RoomData["notifications"]>(),
  rename: vi.fn<RoomData["rename"]>(),
  setAvatar: vi.fn<RoomData["setAvatar"]>(),
  changeMembership: vi.fn<RoomData["changeMembership"]>(),
  setNotifications: vi.fn<RoomData["setNotifications"]>(),
  setTyping: vi.fn<RoomData["setTyping"]>(),
  readSync: vi.fn<RoomData["readSync"]>(),
  search: vi.fn<RoomData["search"]>(),
  setUnread: vi.fn<RoomData["setUnread"]>(),
  markRead: vi.fn<RoomData["markRead"]>(),
  savedCleanupState: vi.fn<RoomData["savedCleanupState"]>(),
  clearUnavailableSavedMessages:
    vi.fn<RoomData["clearUnavailableSavedMessages"]>(),
  savedMessageState: vi.fn<RoomData["savedMessageState"]>(),
  savedMessages: vi.fn<RoomData["savedMessages"]>(),
  saveMessage: vi.fn<RoomData["saveMessage"]>(),
  context: vi.fn<RoomData["context"]>(),
  editMessage: vi.fn<RoomData["editMessage"]>(),
  reportMessage: vi.fn<RoomData["reportMessage"]>(),
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
  mocks.participation = "joined";
  vi.mocked(RoomMessageContext).mockClear();
  mocks.revoked = false;
  mocks.direct = false;
  mocks.hints = [];
  mocks.width = 1000;
  mocks.dark = false;
  mocks.platform = "web";
  mocks.blurSupported = true;
  mocks.preferences = {
    reduceMotion: false,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  };
  mocks.header = undefined;
  vi.stubGlobal("CSS", { supports: () => mocks.blurSupported });
  vi.mocked(useRoomSync).mockClear();
});
function render(selectedMessage?: string, client = new QueryClient()) {
  mocks.materials = [];
  mocks.capsule = undefined;
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RoomConversation
        data={data}
        cacheScope="viewer"
        roomId="binding"
        selectedMessage={selectedMessage}
        onCloseMessage={vi.fn<() => void>()}
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
  expect(html).toContain("Message actions");
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
  expect(mocks.hints).toContain("@ana · conversa direta");
  expect(html).toContain('aria-label="Detalhes de Ana"');
  expect(html).toContain('aria-label="Ver perfil da conversa"');
  expect(html).toContain("Mensagem direta");
  expect(html).not.toContain("Pessoas e Zoen");
  expect(html).not.toContain("Detalhes do grupo");
});

const historyClient = new QueryClient();
afterEach(() => {
  vi.unstubAllGlobals();
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
        workspaceId: "workspace",
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
      workspaceId: "workspace",
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

it("keeps reconnection enabled after a read failure while hiding cached private content", () => {
  mocks.revoked = true;
  const html = render();
  expect(html).not.toContain("Synthetic private text");
  expect(html).toContain("Tentar novamente");
  expect(useRoomSync).toHaveBeenLastCalledWith(
    data,
    "viewer",
    "binding",
    true,
    expect.objectContaining({ ready: true })
  );
});

it("explains revoked access without showing history or a reconnect loop", () => {
  vi.mocked(useRoomSync).mockReturnValueOnce({
    userIds: [],
    presence: [],
    receipts: [],
    reconnecting: false,
    accessDenied: true,
    change: vi.fn<(value: boolean) => void>(),
  });
  const html = render();
  expect(html).toContain("Conversa indisponível");
  expect(html).toContain("Voltar às conversas");
  expect(html).not.toContain("Synthetic private text");
  expect(html).not.toContain("Mensagem ao grupo");
  expect(html).not.toContain("Reconectando");
});

it("waits for participation before history, sync and selected-message context while retaining the scoped cache", () => {
  mocks.participation = "pending";
  const draft = { text: "Unsent room draft" };
  historyClient.setQueryData(
    ["matrix-draft", "viewer", "binding", null],
    draft
  );
  const html = render("$selected", historyClient);
  expect(mocks.options?.queryKey).toEqual([
    "matrix-messages",
    "viewer",
    "binding",
  ]);
  expect(mocks.options?.enabled).toBe(false);
  expect(useRoomSync).toHaveBeenLastCalledWith(
    data,
    "viewer",
    "binding",
    false,
    expect.objectContaining({ ready: false })
  );
  expect(RoomMessageContext).not.toHaveBeenCalled();
  expect(html).toContain("Conectando à conversa");
  expect(html).toContain("Cancelar conexão");
  expect(html).toContain('aria-hidden="true"');
  // Cached nodes remain mounted to retain the list anchor and controlled draft.
  expect(html).toContain("Synthetic private text");
  expect(html).toContain("Unsent room draft");
  expect(
    historyClient.getQueryData(["matrix-draft", "viewer", "binding", null])
  ).toBe(draft);
});

it("rejects a manual history refetch while participation is pending", async () => {
  mocks.participation = "pending";
  vi.mocked(data.messages).mockResolvedValue({
    room: {
      id: "binding",
      roomId: "!room:test",
      label: "Test",
      kind: "group",
      workspaceId: "workspace",
      epoch: "1",
    },
    members: [],
    membersTruncated: false,
    messages: [],
    nextCursor: null,
  });
  render();
  if (!mocks.options) throw new Error("Expected room query options");
  const observer = new InfiniteQueryObserver(historyClient, {
    ...mocks.options,
    enabled: false,
    retry: false,
  });
  const result = await observer.refetch();
  expect(result.error?.message).toBe("Room participation is not confirmed.");
  expect(data.messages).not.toHaveBeenCalled();
});

it("distinguishes terminal participation denial from pending connection without exposing cached history", () => {
  mocks.participation = "denied";
  const html = render();
  expect(html).toContain("Conversa indisponível");
  expect(html).not.toContain("Synthetic private text");
  expect(html).not.toContain("Conectando à conversa");
  expect(mocks.options?.enabled).toBe(false);
  expect(useRoomSync).toHaveBeenLastCalledWith(
    data,
    "viewer",
    "binding",
    false,
    expect.objectContaining({ ready: false })
  );
});

it.each(["error", "cancelled"] as const)(
  "keeps %s participation retry explicit without enabling history",
  (status) => {
    mocks.participation = status;
    const html = render();
    expect(html).toContain("Tentar novamente");
    expect(html).not.toContain("Cancelar conexão");
    expect(mocks.options?.enabled).toBe(false);
    expect(useRoomSync).toHaveBeenLastCalledWith(
      data,
      "viewer",
      "binding",
      false,
      expect.objectContaining({ ready: false })
    );
  }
);

function geometry(style: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(style).filter(
      ([key]) =>
        !["backgroundColor", "borderColor", "backdropFilter"].includes(key)
    )
  );
}
function headerMaterials() {
  expect(mocks.materials).toHaveLength(2);
  expect(mocks.capsule).toBeDefined();
  return [...mocks.materials, ...(mocks.capsule ? [mocks.capsule] : [])];
}
it.each([false, true])(
  "keeps group header material independent of reduced motion in dark %s",
  (dark) => {
    mocks.dark = dark;
    render();
    const normal = headerMaterials();
    mocks.preferences.reduceMotion = true;
    render();
    expect(headerMaterials()).toEqual(normal);
    expect(normal.map((style) => style.backdropFilter)).toEqual(
      Array(3).fill("blur(20px) saturate(180%)")
    );
    expect(mocks.header?.pointerEvents).toBe("box-none");
  }
);
it.each([false, true])(
  "keeps narrow group identity and message controls when transparency is reduced in dark %s",
  (dark) => {
    mocks.width = 390;
    mocks.dark = dark;
    render();
    const normal = headerMaterials().map(geometry);
    mocks.preferences.reduceTransparency = true;
    const markup = render();
    const opaque = headerMaterials();
    expect(opaque.map(geometry)).toEqual(normal);
    expect(opaque.map((style) => style.backgroundColor)).toEqual(
      Array(3).fill(dark ? "#1c1c1e" : "#ffffff")
    );
    expect(opaque.map((style) => style.backdropFilter)).toEqual(
      Array(3).fill("none")
    );
    expect(markup).toContain('aria-label="Voltar às conversas"');
    expect(markup).toContain('aria-label="Detalhes de Shared room"');
    expect(markup).toContain("Synthetic private text");
    expect(markup).toContain("❤️: 2 reações");
  }
);
it.each(["increasedContrast", "forcedColors"] as const)(
  "strengthens group controls for %s while preserving the independent source flag",
  (preference) => {
    render();
    const normal = headerMaterials().map(geometry);
    mocks.preferences[preference] = true;
    render();
    const strong = headerMaterials();
    expect(mocks.preferences.reduceTransparency).toBe(false);
    expect(strong.map(geometry)).toEqual(normal);
    expect(strong.map((style) => style.borderColor)).toEqual(
      Array(3).fill("#1c1c1e")
    );
    expect(strong.map((style) => style.backgroundColor)).toEqual(
      Array(3).fill("#ffffff")
    );
  }
);
it.each(["native", "unsupported-blur"])(
  "keeps group actions with opaque fallback for %s",
  (capability) => {
    mocks.platform = capability === "native" ? "ios" : "web";
    mocks.blurSupported = capability !== "unsupported-blur";
    const markup = render();
    expect(markup).toContain('aria-label="Opções da conversa"');
    expect(markup).toContain("Synthetic private text");
    expect(mocks.capsule?.backgroundColor).toBe("#ffffff");
  }
);


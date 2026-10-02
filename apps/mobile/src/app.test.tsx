import {
  createElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./app";

interface Hook {
  value?: unknown;
  deps?: readonly unknown[];
  set?: (value: unknown) => void;
  callback?: (...args: unknown[]) => unknown;
  invoke?: (...args: unknown[]) => unknown;
  kind?: "layout" | "effect";
  create?: () => void | (() => void);
  cleanup?: () => void;
}
interface Instance {
  component: (props: Record<string, unknown>) => ReactNode;
  hooks: Hook[];
  cursor: number;
  mounted: boolean;
  seen: boolean;
  path: string;
}
interface Effect {
  instance: Instance;
  hook: Hook;
  create: () => void | (() => void);
}
type ShellProps = ComponentProps<
  typeof import("@zoen/companion-ui").CompanionShell
>;
type ConversationProps = ComponentProps<
  typeof import("./conversation").MobileConversation
>;
type ModalProps = ComponentProps<typeof import("react-native").Modal>;

// Effect-boundary scheduling model only; React rendering and device behavior
// require separate qualification. The real App tree sees layout registration
// before passive work without adding a DOM or native renderer dependency.
const state = vi.hoisted(() => ({
  instances: new Map<string, Instance>(),
  defaults: new Map<object, unknown>(),
  contexts: new Map<object, unknown>(),
  current: undefined as Instance | undefined,
  layouts: [] as Effect[],
  effects: [] as Effect[],
  microtasks: [] as (() => void)[],
  dirty: true,
  platform: "android",
  width: 390,
  reduceMotion: false,
  accountId: "account-a" as string | undefined,
  pending: false,
  overlays: [] as string[],
  keepEditing: false,
  closed: [] as string[],
  modals: new Map<string, ModalProps>(),
  overlayOwners: new Map<
    string,
    import("@zoen/companion-ui").CompanionOverlayProps["onClose"]
  >(),
  overlayFocus: vi.fn<() => void>(),
  alerts: [] as ReactNode[],
  shell: undefined as ShellProps | undefined,
  conversation: undefined as
    | { props: ConversationProps; path: string }
    | undefined,
  renderedSessions: [] as (string | undefined)[],
  afterState: undefined as
    | ((previous: unknown, next: unknown) => void)
    | undefined,
  initial: Promise.withResolvers<string | null>(),
  link: undefined as
    | Parameters<typeof import("expo-linking").addEventListener>[1]
    | undefined,
  back: undefined as
    | Parameters<typeof import("react-native").BackHandler.addEventListener>[1]
    | undefined,
  keyboardVisible: false,
  initialRead: vi.fn<() => Promise<string | null>>(),
  linkRemove: vi.fn<() => void>(),
  backRemove: vi.fn<() => void>(),
  dismiss: vi.fn<() => void>(),
  exit: vi.fn<() => void>(),
}));

function nextHook() {
  const instance = state.current;
  if (!instance) throw new Error("Hook called outside the component tree");
  const index = instance.cursor++;
  return (instance.hooks[index] ??= {});
}
function sameDeps(
  left: readonly unknown[] | undefined,
  right: readonly unknown[] | undefined
) {
  return (
    left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]))
  );
}
function effect(
  kind: "layout" | "effect",
  create: () => void | (() => void),
  deps?: readonly unknown[]
) {
  const hook = nextHook();
  if (sameDeps(hook.deps, deps)) return;
  hook.deps = deps;
  hook.kind = kind;
  hook.create = create;
  const instance = state.current;
  if (!instance) throw new Error("Effect called outside the component tree");
  (kind === "layout" ? state.layouts : state.effects).push({
    instance,
    hook,
    create,
  });
}
/* oxlint-disable typescript/no-unsafe-type-assertion -- Mocked React hooks store heterogeneous generic values as unknown; each hook reads only its own originating slot. */
function memo<T>(create: () => T, deps: readonly unknown[]) {
  const hook = nextHook();
  if (!sameDeps(hook.deps, deps)) {
    hook.value = create();
    hook.deps = deps;
  }
  return hook.value as T;
}

vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    createContext: <T,>(value: T) => {
      const context = actual.createContext(value);
      state.defaults.set(context, value);
      return context;
    },
    useContext: <T,>(context: import("react").Context<T>) =>
      (state.contexts.has(context)
        ? state.contexts.get(context)
        : state.defaults.get(context)) as T,
    useState: <T,>(initial?: T | (() => T)) => {
      const hook = nextHook();
      const instance = state.current;
      if (!Object.hasOwn(hook, "value"))
        hook.value =
          typeof initial === "function" ? (initial as () => T)() : initial;
      hook.set ??= (update) => {
        if (!instance?.mounted) return;
        const previous = hook.value;
        const next =
          typeof update === "function"
            ? (update as (value: unknown) => unknown)(previous)
            : update;
        if (!Object.is(previous, next)) {
          hook.value = next;
          state.dirty = true;
          state.afterState?.(previous, next);
        }
      };
      return [hook.value as T, hook.set] as const;
    },
    useRef: <T,>(initial: T) => {
      const hook = nextHook();
      hook.value ??= { current: initial };
      return hook.value as { current: T };
    },
    useMemo: memo,
    useCallback: <T,>(callback: T, deps: readonly unknown[]) =>
      memo(() => callback, deps),
    useEffectEvent: (callback: (...args: unknown[]) => unknown) => {
      const hook = nextHook();
      hook.callback = callback;
      hook.invoke ??= (...args) => hook.callback?.(...args);
      return hook.invoke;
    },
    useEffect: (
      create: () => void | (() => void),
      deps?: readonly unknown[]
    ) => {
      effect("effect", create, deps);
    },
    useLayoutEffect: (
      create: () => void | (() => void),
      deps?: readonly unknown[]
    ) => {
      effect("layout", create, deps);
    },
  };
});
/* oxlint-enable typescript/no-unsafe-type-assertion */

function renderChildren({ children }: { children: ReactNode }) {
  return children;
}

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
  StyleSheet: { create: (value: unknown) => value },
  useWindowDimensions: () => ({ width: state.width, height: 800 }),
  ActivityIndicator: () => null,
  View: ({ children }: { children: ReactNode }) => children,
  Text: ({
    children,
    accessibilityRole,
  }: ComponentProps<typeof import("react-native").Text>) => {
    if (accessibilityRole === "alert") state.alerts.push(children);
    return children;
  },
  Modal: (props: ModalProps) => {
    state.modals.set(props.accessibilityLabel ?? "", props);
    return props.children;
  },
  Keyboard: { isVisible: () => state.keyboardVisible, dismiss: state.dismiss },
  BackHandler: {
    addEventListener: (
      _event: string,
      listener: NonNullable<typeof state.back>
    ) => {
      state.back = listener;
      return { remove: state.backRemove };
    },
    exitApp: state.exit,
  },
}));
vi.mock("expo-linking", () => ({
  getInitialURL: state.initialRead,
  addEventListener: (
    _event: string,
    listener: NonNullable<typeof state.link>
  ) => {
    state.link = listener;
    return { remove: state.linkRemove };
  },
}));
vi.mock("./auth", () => ({
  auth: {
    useSession: () => ({
      isPending: state.pending,
      error: null,
      data: state.accountId
        ? {
            session: { id: state.accountId },
            user: { id: "user-" + state.accountId },
          }
        : null,
    }),
    signOut: vi.fn<typeof import("./auth").auth.signOut>(),
    signIn: { social: vi.fn<typeof import("./auth").auth.signIn.social>() },
  },
}));
vi.mock("@tanstack/react-query", () => ({
  onlineManager: {
    setOnline:
      vi.fn<typeof import("@tanstack/react-query").onlineManager.setOnline>(),
  },
  QueryClient: class {
    clear = vi.fn<import("@tanstack/react-query").QueryClient["clear"]>();
  },
  QueryClientProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@zoen/companion-ui", async () => {
  const react = await import("react");
  const Overlay = react.createContext<
    (props: import("@zoen/companion-ui").CompanionOverlayProps) => ReactNode
  >(() => null);
  const children = renderChildren;
  function OverlayFixture({ id }: { id: string }) {
    const render = react.useContext(Overlay);
    const onClose = () => {
      state.closed.push(id);
      if (state.keepEditing) return;
      state.overlays = state.overlays.filter((overlay) => overlay !== id);
      state.dirty = true;
    };
    state.overlayOwners.set(id, onClose);
    return render({
      title: id,
      children: id,
      onClose,
      focusOnOpen: state.overlayFocus,
    });
  }
  return {
    useAccessibilityPreferences: () => ({
      reduceMotion: state.reduceMotion,
      reduceTransparency: false,
      increasedContrast: false,
      forcedColors: false,
    }),
    ActionButton: children,
    GesturePreferenceProvider: children,
    MarkdownEditorProvider: children,
    ComposerEditorProvider: children,
    AttachmentProvider: children,
    LinkPreviewProvider: children,
    ComposerReferenceProvider: children,
    CompanionOverlayProvider: ({
      children: nested,
      renderOverlay,
    }: ComponentProps<
      typeof import("@zoen/companion-ui").CompanionOverlayProvider
    >) => react.createElement(Overlay, { value: renderOverlay }, nested),
    CompanionShell: (props: ShellProps) => {
      state.shell = props;
      return react.createElement(
        react.Fragment,
        null,
        props.children,
        state.overlays.map((id) =>
          react.createElement(OverlayFixture, { key: id, id })
        )
      );
    },
  };
});
vi.mock("@zoen/companion-ui/local-messages", () => ({
  LocalMessagesProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@zoen/companion-ui/previews", () => ({
  linkPreviewSchema: { parse: (value: unknown) => value },
}));
vi.mock("@zoen/companion-ui/references", () => ({
  referenceResultsSchema: { parse: (value: unknown) => value },
}));
vi.mock("expo-network", () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
  SafeAreaView: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./gesture-storage", () => ({ gestureStorage: {} }));
vi.mock("./message-storage", () => ({ mobileMessageStorage: () => ({}) }));
vi.mock("./audio-recording", () => ({ useAudioRecording: () => undefined }));
vi.mock("./composer", () => ({ renderComposerEditor: () => null }));
vi.mock("./media", () => ({ renderMedia: () => null }));
vi.mock("./api", () => ({
  rpc: {
    query: vi.fn<typeof import("./api").rpc.query>(),
    mutation: vi.fn<typeof import("./api").rpc.mutation>(),
  },
}));
vi.mock("./agent-panel", () => ({
  MobileAgentPanel: () => null,
  MobileAgentHeader: () => null,
  MobileAgentName: () => null,
}));
vi.mock("./conversation", () => ({
  MobileConversation: (props: ConversationProps) => {
    const instance = state.current;
    if (!instance)
      throw new Error("Conversation rendered outside its component tree");
    state.conversation = { props, path: instance.path };
    state.renderedSessions.push(props.sessionId);
    return null;
  },
}));
vi.mock("./inbox", () => ({ MobileInbox: () => null, MobileRoom: () => null }));
vi.mock("./sections", () => ({ MobileSections: () => null }));
vi.mock("./environment", () => ({ apiOrigin: "https://app.tryzoen.com" }));
vi.mock("./editor", () => ({ MobileEditor: () => null }));
vi.mock("./attachments", () => ({
  pickAttachments: vi.fn<typeof import("./attachments").pickAttachments>(),
  saveAttachment: vi.fn<typeof import("./attachments").saveAttachment>(),
}));

function visit(node: ReactNode, path: string) {
  if (Array.isArray(node)) {
    node.forEach((child: ReactNode, index) => {
      const key = isValidElement(child)
        ? (child.key ?? String(index))
        : String(index);
      visit(child, path + "/" + key);
    });
    return;
  }
  if (!isValidElement<{ children?: ReactNode; value?: unknown }>(node)) return;
  // React's public element type omits the context objects used by React 19 JSX.
  const type: unknown = node.type;
  if (typeof type === "function") {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This boundary invokes the App tree's function components; it does not model class component construction.
    const component = type as (props: Record<string, unknown>) => ReactNode;
    let instance = state.instances.get(path);
    if (!instance || instance.component !== component) {
      if (instance) dispose(instance);
      instance = {
        component,
        hooks: [],
        cursor: 0,
        mounted: true,
        seen: true,
        path,
      };
      state.instances.set(path, instance);
    }
    instance.seen = true;
    instance.cursor = 0;
    const previous = state.current;
    state.current = instance;
    const result = component(node.props);
    state.current = previous;
    visit(result, path + "/render");
  } else if (
    typeof type === "object" &&
    type !== null &&
    state.defaults.has(type)
  ) {
    const hadValue = state.contexts.has(type);
    const previous = state.contexts.get(type);
    state.contexts.set(type, node.props.value);
    visit(node.props.children, path + "/provider");
    if (hadValue) state.contexts.set(type, previous);
    else state.contexts.delete(type);
  } else visit(node.props.children, path + "/children");
}
function dispose(instance: Instance) {
  instance.mounted = false;
  for (const hook of instance.hooks) {
    hook.cleanup?.();
    hook.cleanup = undefined;
  }
}
function runEffects(effects: Effect[]) {
  for (const scheduled of effects) {
    if (!scheduled.instance.mounted) continue;
    scheduled.hook.cleanup?.();
    const cleanup = scheduled.create();
    scheduled.hook.cleanup =
      typeof cleanup === "function" ? cleanup : undefined;
  }
}
function commit() {
  state.dirty = false;
  state.modals.clear();
  state.alerts = [];
  state.conversation = undefined;
  for (const instance of state.instances.values()) instance.seen = false;
  visit(createElement(App), "app");
  for (const [path, instance] of state.instances) {
    if (!instance.seen) {
      dispose(instance);
      state.instances.delete(path);
    }
  }
  runEffects(state.layouts.splice(0).toReversed());
}
function flush() {
  for (let pass = 0; pass < 40; pass++) {
    if (state.dirty) commit();
    runEffects(state.effects.splice(0));
    // Deliberately execute queued work before a layout-triggered rerender.
    for (const task of state.microtasks.splice(0)) task();
    if (
      !state.dirty &&
      state.effects.length === 0 &&
      state.microtasks.length === 0
    )
      return;
  }
  throw new Error("App scheduling did not settle");
}
function replayLayouts() {
  const layouts: Effect[] = [];
  for (const instance of state.instances.values())
    for (const hook of instance.hooks)
      if (hook.kind === "layout" && hook.create)
        layouts.push({ instance, hook, create: hook.create });
  for (const { hook } of layouts) {
    hook.cleanup?.();
    hook.cleanup = undefined;
  }
  runEffects(layouts.toReversed());
}
function unmount() {
  for (const instance of state.instances.values()) instance.mounted = false;
  for (const instance of state.instances.values()) dispose(instance);
  state.instances.clear();
}
function link(id: string) {
  if (!state.link) throw new Error("Content listener was not installed");
  state.link({ url: "zoen://companion/" + id });
}
function account(id: string | undefined, pending = false) {
  state.accountId = id;
  state.pending = pending;
  state.dirty = true;
  flush();
}
function requestClose(id: string) {
  const close = state.modals.get(id)?.onRequestClose;
  // The actual adapter forwards a zero-argument owner; the native boundary
  // supplies its event without requiring a platform runtime.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The actual adapter forwards a zero-argument owner that ignores the native event; this fixture exercises that boundary without a native event runtime.
  close?.({} as Parameters<NonNullable<ModalProps["onRequestClose"]>>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.instances.clear();
  state.contexts.clear();
  state.layouts = [];
  state.effects = [];
  state.microtasks = [];
  state.current = undefined;
  state.dirty = true;
  state.platform = "android";
  state.width = 390;
  state.reduceMotion = false;
  state.accountId = "account-a";
  state.pending = false;
  state.overlays = [];
  state.closed = [];
  state.keepEditing = false;
  state.modals.clear();
  state.overlayOwners.clear();
  state.alerts = [];
  state.shell = undefined;
  state.conversation = undefined;
  state.renderedSessions = [];
  state.afterState = undefined;
  state.initial = Promise.withResolvers<string | null>();
  state.initialRead.mockImplementation(() => state.initial.promise);
  state.link = undefined;
  state.back = undefined;
  state.keyboardVisible = false;
  vi.stubGlobal("queueMicrotask", (task: () => void) => {
    state.microtasks.push(task);
  });
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

test("same-commit overlay registration blocks a queued locator without closing its owner", () => {
  flush();
  link("first");
  state.overlays = ["dirty-editor"];
  state.keepEditing = true;
  flush();
  expect(state.conversation?.props.sessionId).toBeUndefined();
  expect(state.closed).toEqual([]);
  requestClose("dirty-editor");
  flush();
  expect(state.closed).toEqual(["dirty-editor"]);
  expect(state.conversation?.props.sessionId).toBeUndefined();
  state.keepEditing = false;
  requestClose("dirty-editor");
  flush();
  expect(state.conversation?.props.sessionId).toBe("first");
});

test("only the latest deferred link drains after the final nested overlay closes", () => {
  state.overlays = ["editor", "history"];
  flush();
  link("first");
  flush();
  link("latest");
  flush();
  replayLayouts();
  flush();
  expect(state.conversation?.props.sessionId).toBeUndefined();
  requestClose("history");
  flush();
  expect(state.conversation?.props.sessionId).toBeUndefined();
  requestClose("editor");
  flush();
  expect(state.conversation?.props.sessionId).toBe("latest");
  expect(state.renderedSessions).not.toContain("first");
  expect(state.initialRead).toHaveBeenCalledOnce();
});

test("deferred content belonging to A is discarded on sign-out and cannot drain into B", () => {
  state.overlays = ["editor"];
  flush();
  link("private-a");
  flush();
  account(undefined);
  state.overlays = [];
  account("account-b");
  expect(state.conversation?.props.sessionId).toBeUndefined();
  expect(state.renderedSessions).not.toContain("private-a");
});

test("signed-out cold startup binds to the first settled account once", async () => {
  state.accountId = undefined;
  flush();
  state.link?.({ url: "zoen://?cookie=opaque-callback" });
  state.link?.({ url: "https://outside.example/other/../companion/external" });
  flush();
  state.initial.resolve("zoen://companion/cold");
  await state.initial.promise;
  flush();
  account(undefined, true);
  account("account-a");
  expect(state.conversation?.props.sessionId).toBe("cold");
  account(undefined);
  account("account-b");
  expect(state.conversation?.props.sessionId).toBeUndefined();
  expect(state.initialRead).toHaveBeenCalledOnce();
});

test("a cold locator cannot bind to B when A and B commit before passive reconciliation", async () => {
  state.accountId = undefined;
  flush();
  state.initial.resolve("zoen://companion/cold-before-switch");
  await state.initial.promise;
  flush();
  state.accountId = "account-a";
  state.dirty = true;
  commit();
  state.accountId = "account-b";
  state.dirty = true;
  commit();
  flush();
  expect(state.conversation?.props.sessionId).toBeUndefined();
  expect(state.renderedSessions).not.toContain("cold-before-switch");
});

test.each(["resolve", "reject"] as const)(
  "late initial %s stays invalid after A departs and returns",
  async (completion) => {
    flush();
    account(undefined);
    account("account-b");
    account("account-a");
    if (completion === "resolve")
      state.initial.resolve("zoen://companion/stale-cold");
    else state.initial.reject(new Error("Startup lookup failed"));
    await state.initial.promise.catch(() => undefined);
    flush();
    expect(state.conversation?.props.sessionId).toBeUndefined();
    expect(state.renderedSessions).not.toContain("stale-cold");
    expect(state.shell?.conversationOpen).toBe(false);
    expect(state.alerts).toEqual([]);
  }
);

test("a warm link during B sign-in after A departed waits for B", () => {
  flush();
  account(undefined);
  account(undefined, true);
  link("new-account-link");
  flush();
  account("account-b");
  expect(state.conversation?.props.sessionId).toBe("new-account-link");
});

test("acknowledging an older handled locator cannot clear a newer delivery", () => {
  flush();
  state.afterState = (_previous, next) => {
    if (
      typeof next === "object" &&
      next !== null &&
      "conversation" in next &&
      typeof next.conversation === "object" &&
      next.conversation !== null &&
      "id" in next.conversation &&
      next.conversation.id === "first"
    ) {
      state.afterState = undefined;
      link("newer");
    }
  };
  link("first");
  flush();
  expect(state.conversation?.props.sessionId).toBe("newer");
});

test("same-session links preserve the mounted conversation and its supplied draft", () => {
  flush();
  state.conversation?.props.onCreated("existing", {
    text: "unsent",
    files: [],
  });
  flush();
  const previous = state.conversation;
  link("existing");
  flush();
  link("existing");
  flush();
  expect(state.conversation?.path).toBe(previous?.path);
  expect(state.conversation?.props.initialDraft).toBe(
    previous?.props.initialDraft
  );
  expect(state.conversation?.props.initialDraft?.text).toBe("unsent");
});

test("late creation from a replaced composer cannot overwrite the linked session", () => {
  flush();
  const created = state.conversation?.props.onCreated;
  link("linked");
  flush();
  created?.("late-created");
  flush();
  expect(state.conversation?.props.sessionId).toBe("linked");
});

test("Android Back dismisses the keyboard, consumes overlays, preserves the conversation and delegates at root", () => {
  flush();
  link("conversation");
  flush();
  state.keyboardVisible = true;
  expect(state.back?.({ type: "hardwareBackPress", timeStamp: 0 })).toBe(true);
  flush();
  expect(state.dismiss).toHaveBeenCalledOnce();
  expect(state.shell?.conversationOpen).toBe(true);
  state.keyboardVisible = false;
  state.overlays = ["editor"];
  state.dirty = true;
  flush();
  expect(state.back?.({ type: "hardwareBackPress", timeStamp: 0 })).toBe(true);
  flush();
  expect(state.closed).toEqual([]);
  requestClose("editor");
  flush();
  const path = state.conversation?.path;
  expect(state.back?.({ type: "hardwareBackPress", timeStamp: 0 })).toBe(true);
  flush();
  expect(state.shell?.conversationOpen).toBe(false);
  expect(state.conversation?.path).toBe(path);
  expect(state.back?.({ type: "hardwareBackPress", timeStamp: 0 })).toBe(false);
  expect(state.exit).not.toHaveBeenCalled();
  unmount();
  expect(state.backRemove).toHaveBeenCalledOnce();
  expect(state.linkRemove).toHaveBeenCalledOnce();
});

test("web keeps its overlay owner without native links or Android Back", () => {
  state.platform = "web";
  state.overlays = ["editor"];
  flush();
  expect(state.back).toBeUndefined();
  expect(state.modals.size).toBe(0);
  expect(state.initialRead).not.toHaveBeenCalled();
});

test("iOS preserves native Modal settings without registering Android Back", () => {
  state.platform = "ios";
  state.overlays = ["editor"];
  flush();
  expect(state.back).toBeUndefined();
  expect(state.modals.get("editor")?.transparent).toBe(true);
  expect(state.modals.get("editor")?.animationType).toBe("slide");
});

test.each([
  { platform: "ios", width: 390, ordinary: "slide" },
  { platform: "ios", width: 1024, ordinary: "fade" },
  { platform: "android", width: 390, ordinary: "slide" },
  { platform: "android", width: 1024, ordinary: "fade" },
])(
  "$platform at $width respects Reduce Motion while preserving the Modal owner",
  ({ platform, width, ordinary }) => {
    state.platform = platform;
    state.width = width;
    state.reduceMotion = true;
    state.overlays = ["editor"];
    flush();
    expect(state.modals.get("editor")?.animationType).toBe("none");
    expect(state.modals.get("editor")?.transparent).toBe(true);
    expect(state.modals.get("editor")?.onShow).toBe(state.overlayFocus);
    expect(state.modals.get("editor")?.onRequestClose).toBe(
      state.overlayOwners.get("editor")
    );
    expect(state.closed).toEqual([]);
    state.reduceMotion = false;
    state.dirty = true;
    flush();
    expect(state.modals.get("editor")?.animationType).toBe(ordinary);
    expect(state.modals.get("editor")?.transparent).toBe(true);
    expect(state.modals.get("editor")?.onShow).toBe(state.overlayFocus);
    expect(state.modals.get("editor")?.onRequestClose).toBe(
      state.overlayOwners.get("editor")
    );
  }
);

test("a Reduce Motion change retains a dirty overlay, deferred links and keyboard-first Android Back", () => {
  state.overlays = ["dirty-editor"];
  state.keepEditing = true;
  flush();
  link("first");
  flush();
  link("latest");
  flush();
  state.reduceMotion = true;
  state.dirty = true;
  flush();
  expect(state.modals.get("dirty-editor")?.animationType).toBe("none");
  expect(state.closed).toEqual([]);
  expect(state.conversation?.props.sessionId).toBeUndefined();
  state.keyboardVisible = true;
  expect(state.back?.({ type: "hardwareBackPress", timeStamp: 0 })).toBe(true);
  expect(state.dismiss).toHaveBeenCalledExactlyOnceWith();
  expect(state.closed).toEqual([]);
  state.keyboardVisible = false;
  expect(state.back?.({ type: "hardwareBackPress", timeStamp: 0 })).toBe(true);
  expect(state.closed).toEqual([]);
  requestClose("dirty-editor");
  flush();
  expect(state.closed).toEqual(["dirty-editor"]);
  expect(state.conversation?.props.sessionId).toBeUndefined();
  state.reduceMotion = false;
  state.dirty = true;
  flush();
  expect(state.modals.get("dirty-editor")?.animationType).toBe("slide");
  expect(state.conversation?.props.sessionId).toBeUndefined();
  state.keepEditing = false;
  requestClose("dirty-editor");
  flush();
  expect(state.conversation?.props.sessionId).toBe("latest");
  expect(state.renderedSessions).not.toContain("first");
});

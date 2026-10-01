import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  platform: "web",
  dark: false,
  capture: true,
  unavailable: false,
  subscribe: undefined as ((notify: () => void) => () => void) | undefined,
  snapshot: undefined as (() => unknown) | undefined,
  server: undefined as (() => unknown) | undefined,
  listeners: new Map<string, Set<(value: boolean) => void>>(),
  removed: vi.fn<(event: string) => void>(),
  motion: vi.fn<() => Promise<boolean>>(),
  transparency: vi.fn<() => Promise<boolean>>(),
  iosContrast: vi.fn<() => Promise<boolean>>(),
  androidContrast: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useSyncExternalStore: <Snapshot,>(
      subscribe: (notify: () => void) => () => void,
      snapshot: () => Snapshot,
      server?: () => Snapshot
    ) => {
      if (!state.capture)
        return react.useSyncExternalStore(subscribe, snapshot, server);
      state.subscribe = subscribe;
      state.snapshot = snapshot;
      state.server = server;
      return snapshot();
    },
  };
});
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
  useColorScheme: () => (state.dark ? "dark" : "light"),
  AccessibilityInfo: {
    isReduceMotionEnabled: state.motion,
    isReduceTransparencyEnabled: state.transparency,
    isDarkerSystemColorsEnabled: state.iosContrast,
    isHighTextContrastEnabled: state.androidContrast,
    addEventListener: (event: string, listener: (value: boolean) => void) => {
      if (state.unavailable) throw new Error("Native event source unavailable");
      const listeners =
        state.listeners.get(event) ?? new Set<(value: boolean) => void>();
      listeners.add(listener);
      state.listeners.set(event, listeners);
      return {
        remove: () => {
          listeners.delete(listener);
          state.removed(event);
        },
      };
    },
  },
}));

const disposals: (() => void)[] = [];
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.platform = "web";
  state.dark = false;
  state.capture = true;
  state.unavailable = false;
  state.listeners.clear();
  state.subscribe = undefined;
  state.snapshot = undefined;
  state.server = undefined;
  for (const read of [
    state.motion,
    state.transparency,
    state.iosContrast,
    state.androidContrast,
  ])
    read.mockResolvedValue(false);
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.unstubAllGlobals();
});

async function mount() {
  const theme = await import("./theme");
  theme.useAccessibilityPreferences();
  if (!state.subscribe)
    throw new Error("Missing system preference subscription");
  const notify = vi.fn<() => void>();
  const dispose = state.subscribe(notify);
  disposals.push(dispose);
  return { notify, dispose, theme };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
function emit(event: string, value: boolean) {
  for (const listener of state.listeners.get(event) ?? []) listener(value);
}
function deferred() {
  let finish: ((value: boolean) => void) | undefined;
  const promise = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  return {
    promise,
    resolve(value: boolean) {
      if (!finish) throw new Error("Uninitialized native query");
      finish(value);
    },
  };
}
function media() {
  const queries = new Map<
    string,
    {
      matches: boolean;
      listeners: Set<() => void>;
      addEventListener: (event: string, listener: () => void) => void;
      removeEventListener: (event: string, listener: () => void) => void;
    }
  >();
  const matchMedia = vi.fn<(query: string) => unknown>((query) => {
    let result = queries.get(query);
    if (!result) {
      const listeners = new Set<() => void>();
      result = {
        matches: query.includes(": no-preference"),
        listeners,
        addEventListener: (_event, listener) => {
          listeners.add(listener);
        },
        removeEventListener: (_event, listener) => {
          listeners.delete(listener);
        },
      };
      queries.set(query, result);
    }
    return result;
  });
  vi.stubGlobal("window", { matchMedia });
  const change = (values: Record<string, boolean>) => {
    for (const [query, value] of Object.entries(values)) {
      const item = queries.get(query);
      if (!item) throw new Error("Unsubscribed query: " + query);
      item.matches = value;
    }
    for (const query of Object.keys(values))
      for (const listener of queries.get(query)?.listeners ?? []) listener();
  };
  return { queries, matchMedia, change };
}

it("renders the actual conservative server snapshot without touching browser or native APIs", async () => {
  state.capture = false;
  const theme = await import("./theme");
  function Probe() {
    const preferences = theme.useAccessibilityPreferences();
    return (
      <output
        data-motion={preferences.reduceMotion}
        data-transparency={preferences.reduceTransparency}
      />
    );
  }
  expect(renderToStaticMarkup(<Probe />)).toContain('data-motion="true"');
  expect(renderToStaticMarkup(<Probe />)).toContain('data-transparency="true"');
  expect(state.motion).not.toHaveBeenCalled();
  expect(state.listeners.size).toBe(0);
});

it("shares browser listeners, keeps snapshots stable and updates independent preferences", async () => {
  const browser = media();
  const first = await mount(),
    second = await mount();
  expect(browser.matchMedia).toHaveBeenCalledTimes(6);
  for (const query of browser.queries.values())
    expect(query.listeners.size).toBe(1);
  const initial = state.snapshot?.();
  first.notify.mockClear();
  second.notify.mockClear();
  expect(initial).toEqual({
    reduceMotion: false,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  });
  browser.change({ "(prefers-reduced-motion: reduce)": false });
  expect(state.snapshot?.()).toBe(initial);
  expect(first.notify).not.toHaveBeenCalled();
  browser.change({
    "(prefers-reduced-motion: reduce)": true,
    "(prefers-reduced-motion: no-preference)": false,
  });
  expect(state.snapshot?.()).toEqual({
    reduceMotion: true,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  });
  expect(first.notify).toHaveBeenCalledOnce();
  expect(second.notify).toHaveBeenCalledOnce();
  first.dispose();
  browser.change({
    "(prefers-contrast: more)": true,
    "(forced-colors: active)": true,
  });
  expect(first.notify).toHaveBeenCalledOnce();
  expect(state.snapshot?.()).toMatchObject({
    increasedContrast: true,
    forcedColors: true,
    reduceTransparency: false,
  });
  second.dispose();
  for (const query of browser.queries.values())
    expect(query.listeners.size).toBe(0);
});

it("keeps unsupported transparency opaque and refreshes the source after the last subscriber leaves", async () => {
  const browser = media();
  // Neither recognized value matches when the browser does not implement the feature.
  const original = browser.matchMedia.getMockImplementation();
  browser.matchMedia.mockImplementation((query) => {
    const value = original?.(query);
    const item = browser.queries.get(query);
    if (query.includes("prefers-reduced-transparency") && item)
      item.matches = false;
    return value;
  });
  const first = await mount();
  expect(state.snapshot?.()).toMatchObject({
    reduceTransparency: true,
    reduceMotion: false,
  });
  first.dispose();
  expect(state.snapshot?.()).toEqual(state.server?.());
  browser.matchMedia.mockImplementation((query) => {
    const value = original?.(query);
    const item = browser.queries.get(query);
    if (query.includes("prefers-reduced-transparency") && item)
      item.matches = query.includes("no-preference");
    return value;
  });
  await mount();
  expect(state.snapshot?.()).toMatchObject({ reduceTransparency: false });
});

it("shares native listeners and lets newer events win over delayed initial queries", async () => {
  state.platform = "ios";
  const motion = deferred(),
    transparency = deferred(),
    contrast = deferred();
  state.motion.mockReturnValue(motion.promise);
  state.transparency.mockReturnValue(transparency.promise);
  state.iosContrast.mockReturnValue(contrast.promise);
  const first = await mount(),
    second = await mount();
  await settle();
  expect(state.motion).toHaveBeenCalledOnce();
  for (const listeners of state.listeners.values())
    expect(listeners.size).toBe(1);
  emit("reduceMotionChanged", true);
  emit("reduceTransparencyChanged", true);
  emit("darkerSystemColorsChanged", true);
  motion.resolve(false);
  transparency.resolve(false);
  contrast.resolve(false);
  await settle();
  expect(state.snapshot?.()).toEqual({
    reduceMotion: true,
    reduceTransparency: true,
    increasedContrast: true,
    forcedColors: false,
  });
  first.dispose();
  expect(state.removed).not.toHaveBeenCalled();
  second.dispose();
  expect(state.removed).toHaveBeenCalledTimes(3);
});

it("ignores initial native queries after cleanup and retains safe fallbacks when a query fails", async () => {
  state.platform = "ios";
  const old = deferred();
  state.motion.mockReturnValue(old.promise);
  state.transparency.mockRejectedValue(
    new Error("Native preference unavailable")
  );
  const first = await mount();
  await settle();
  first.dispose();
  old.resolve(false);
  await settle();
  expect(state.snapshot?.()).toEqual(state.server?.());
  state.motion.mockResolvedValue(false);
  await mount();
  await settle();
  expect(state.snapshot?.()).toMatchObject({
    reduceMotion: false,
    reduceTransparency: true,
  });
});

it("uses only the supported Android sources and does not take ownership of appearance", async () => {
  state.platform = "android";
  const { theme } = await mount();
  await settle();
  expect(state.transparency).not.toHaveBeenCalled();
  expect(state.iosContrast).not.toHaveBeenCalled();
  expect(state.androidContrast).toHaveBeenCalledOnce();
  emit("highTextContrastChanged", true);
  expect(state.snapshot?.()).toMatchObject({
    increasedContrast: true,
    reduceTransparency: true,
  });
  expect(theme.useDarkAppearance()).toBe(false);
  state.dark = true;
  expect(theme.useDarkAppearance()).toBe(true);
});

it("retains safe preferences when the native event source is unavailable", async () => {
  state.platform = "ios";
  state.unavailable = true;
  await mount();
  await settle();
  expect(state.snapshot?.()).toEqual(state.server?.());
  expect(state.motion).not.toHaveBeenCalled();
  expect(state.listeners.size).toBe(0);
});

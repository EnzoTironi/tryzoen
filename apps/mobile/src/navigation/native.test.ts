import { beforeEach, expect, test, vi } from "vitest";
import { subscribeAndroidBack, subscribeContentLinks } from "./native";

const mocks = vi.hoisted(() => ({
  platform: "ios",
  initial: vi.fn<typeof import("expo-linking").getInitialURL>(),
  linkAdd:
    vi.fn<
      (
        ...args: Parameters<typeof import("expo-linking").addEventListener>
      ) => Pick<
        ReturnType<typeof import("expo-linking").addEventListener>,
        "remove"
      >
    >(),
  linkRemove: vi.fn<() => void>(),
  warm: undefined as
    | Parameters<typeof import("expo-linking").addEventListener>[1]
    | undefined,
  backAdd:
    vi.fn<
      (
        ...args: Parameters<
          typeof import("react-native").BackHandler.addEventListener
        >
      ) => Pick<
        ReturnType<typeof import("react-native").BackHandler.addEventListener>,
        "remove"
      >
    >(),
  backRemove: vi.fn<() => void>(),
  back: undefined as
    | Parameters<typeof import("react-native").BackHandler.addEventListener>[1]
    | undefined,
  visible: vi.fn<() => boolean>(),
  dismiss: vi.fn<() => void>(),
  exit: vi.fn<() => void>(),
}));
vi.mock("expo-linking", () => ({
  addEventListener: mocks.linkAdd,
  getInitialURL: mocks.initial,
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
  BackHandler: { addEventListener: mocks.backAdd, exitApp: mocks.exit },
  Keyboard: { isVisible: mocks.visible, dismiss: mocks.dismiss },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.platform = "ios";
  mocks.warm = undefined;
  mocks.back = undefined;
  mocks.initial.mockResolvedValue(null);
  mocks.visible.mockReturnValue(false);
  mocks.linkAdd.mockImplementation((_event, listener) => {
    mocks.warm = listener;
    return { remove: mocks.linkRemove };
  });
  mocks.backAdd.mockImplementation((_event, listener) => {
    mocks.back = listener;
    return { remove: mocks.backRemove };
  });
});

test.each(["ios", "android"])(
  "%s registers warm links before reading the cold URL",
  async (platform) => {
    mocks.platform = platform;
    const pending = Promise.withResolvers<string | null>();
    mocks.initial.mockReturnValue(pending.promise);
    const onLink = vi
      .fn<Parameters<typeof subscribeContentLinks>[0]>()
      .mockReturnValue(true);
    const onError = vi.fn<() => void>();
    const dispose = subscribeContentLinks(onLink, onError);
    expect(mocks.linkAdd).toHaveBeenCalledWith("url", expect.any(Function));
    expect(mocks.linkAdd.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.initial.mock.invocationCallOrder[0] ?? Infinity
    );
    pending.resolve("zoen:///companion/session-one");
    await pending.promise;
    expect(onLink).toHaveBeenCalledExactlyOnceWith(
      "zoen:///companion/session-one",
      "initial"
    );
    expect(onError).not.toHaveBeenCalled();
    dispose();
    expect(mocks.linkRemove).toHaveBeenCalledOnce();
  }
);

test("a warm link supersedes a late cold URL, including the same URL", async () => {
  const pending = Promise.withResolvers<string | null>();
  mocks.initial.mockReturnValue(pending.promise);
  const onLink = vi
    .fn<Parameters<typeof subscribeContentLinks>[0]>()
    .mockReturnValue(true);
  const dispose = subscribeContentLinks(onLink, vi.fn<() => void>());
  mocks.warm?.({ url: "zoen:///companion/session-one" });
  pending.resolve("zoen:///companion/session-one");
  await pending.promise;
  expect(onLink).toHaveBeenCalledExactlyOnceWith(
    "zoen:///companion/session-one",
    "event"
  );
  dispose();
});

test("the latest warm link wins over a different late cold URL", async () => {
  const pending = Promise.withResolvers<string | null>();
  mocks.initial.mockReturnValue(pending.promise);
  const onLink = vi
    .fn<Parameters<typeof subscribeContentLinks>[0]>()
    .mockReturnValue(true);
  const dispose = subscribeContentLinks(onLink, vi.fn<() => void>());
  mocks.warm?.({ url: "zoen:///companion/session-two" });
  pending.resolve("zoen:///companion/session-one");
  await pending.promise;
  expect(onLink).toHaveBeenCalledExactlyOnceWith(
    "zoen:///companion/session-two",
    "event"
  );
  dispose();
});

test("repeated warm links remain dispatchable after intentional later navigation", async () => {
  const onLink = vi
    .fn<Parameters<typeof subscribeContentLinks>[0]>()
    .mockReturnValue(true);
  const dispose = subscribeContentLinks(onLink, vi.fn<() => void>());
  await Promise.resolve();
  mocks.warm?.({ url: "zoen:///companion/session-one" });
  mocks.warm?.({ url: "zoen:///companion/session-two" });
  mocks.warm?.({ url: "zoen:///companion/session-one" });
  expect(onLink.mock.calls).toEqual([
    ["zoen:///companion/session-one", "event"],
    ["zoen:///companion/session-two", "event"],
    ["zoen:///companion/session-one", "event"],
  ]);
  dispose();
});

test("a resolved initial URL does not suppress a later warm navigation to it", async () => {
  mocks.initial.mockResolvedValue("zoen:///companion/session-one");
  const onLink = vi
    .fn<Parameters<typeof subscribeContentLinks>[0]>()
    .mockReturnValue(true);
  const dispose = subscribeContentLinks(onLink, vi.fn<() => void>());
  await Promise.resolve();
  mocks.warm?.({ url: "zoen:///companion/session-one" });
  expect(onLink).toHaveBeenCalledTimes(2);
  dispose();
});

test("null cold URLs do not dispatch content", async () => {
  const onLink = vi
    .fn<Parameters<typeof subscribeContentLinks>[0]>()
    .mockReturnValue(true);
  const onError = vi.fn<() => void>();
  const dispose = subscribeContentLinks(onLink, onError);
  await Promise.resolve();
  expect(onLink).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  dispose();
});

test.each(["resolve", "reject"])(
  "disposal ignores late initial %s and stale warm events",
  async (result) => {
    const pending = Promise.withResolvers<string | null>();
    mocks.initial.mockReturnValue(pending.promise);
    const onLink = vi
      .fn<Parameters<typeof subscribeContentLinks>[0]>()
      .mockReturnValue(true);
    const onError = vi.fn<() => void>();
    const dispose = subscribeContentLinks(onLink, onError);
    dispose();
    dispose();
    mocks.warm?.({ url: "zoen:///companion/session-two" });
    if (result === "resolve") {
      pending.resolve("zoen:///companion/session-one");
      await pending.promise;
    } else {
      pending.reject(new Error("Synthetic initial URL failure"));
      await pending.promise.catch(() => undefined);
    }
    expect(onLink).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.linkRemove).toHaveBeenCalledOnce();
  }
);

test("an active initial URL rejection reports failure without its payload", async () => {
  const pending = Promise.withResolvers<string | null>();
  mocks.initial.mockReturnValue(pending.promise);
  const onError = vi.fn<() => void>();
  const dispose = subscribeContentLinks(
    vi.fn<Parameters<typeof subscribeContentLinks>[0]>().mockReturnValue(true),
    onError
  );
  pending.reject(new Error("Synthetic initial URL failure"));
  await expect(pending.promise).rejects.toThrow(
    "Synthetic initial URL failure"
  );
  expect(onError).toHaveBeenCalledExactlyOnceWith();
  dispose();
});

test("a warm link also supersedes a late initial rejection", async () => {
  const pending = Promise.withResolvers<string | null>();
  mocks.initial.mockReturnValue(pending.promise);
  const onError = vi.fn<() => void>();
  const dispose = subscribeContentLinks(
    vi.fn<Parameters<typeof subscribeContentLinks>[0]>().mockReturnValue(true),
    onError
  );
  mocks.warm?.({ url: "zoen:///companion/session-two" });
  pending.reject(new Error("Synthetic initial URL failure"));
  await expect(pending.promise).rejects.toThrow(
    "Synthetic initial URL failure"
  );
  expect(onError).not.toHaveBeenCalled();
  dispose();
});

test("a synchronous initial URL failure keeps the warm subscription usable", () => {
  mocks.initial.mockImplementation(() => {
    throw new Error("Synthetic initial URL failure");
  });
  const onLink = vi
    .fn<Parameters<typeof subscribeContentLinks>[0]>()
    .mockReturnValue(true);
  const onError = vi.fn<() => void>();
  const dispose = subscribeContentLinks(onLink, onError);
  expect(onError).toHaveBeenCalledExactlyOnceWith();
  mocks.warm?.({ url: "zoen:///companion/session-two" });
  expect(onLink).toHaveBeenCalledExactlyOnceWith(
    "zoen:///companion/session-two",
    "event"
  );
  dispose();
});

test("a failed warm subscription reports failure and does not read a cold URL", () => {
  mocks.linkAdd.mockImplementation(() => {
    throw new Error("Synthetic subscription failure");
  });
  const onError = vi.fn<() => void>();
  const dispose = subscribeContentLinks(
    vi.fn<Parameters<typeof subscribeContentLinks>[0]>().mockReturnValue(true),
    onError
  );
  expect(onError).toHaveBeenCalledExactlyOnceWith();
  expect(mocks.initial).not.toHaveBeenCalled();
  dispose();
  expect(mocks.linkRemove).not.toHaveBeenCalled();
});

test("web link subscriptions are inert", () => {
  mocks.platform = "web";
  const onLink = vi
    .fn<Parameters<typeof subscribeContentLinks>[0]>()
    .mockReturnValue(true);
  const onError = vi.fn<() => void>();
  subscribeContentLinks(onLink, onError)();
  expect(mocks.linkAdd).not.toHaveBeenCalled();
  expect(mocks.initial).not.toHaveBeenCalled();
  expect(onLink).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

test("Android back dismisses the visible keyboard before navigation", () => {
  mocks.platform = "android";
  mocks.visible.mockReturnValue(true);
  const onBack = vi.fn<() => boolean>();
  const dispose = subscribeAndroidBack(onBack);
  expect(mocks.backAdd).toHaveBeenCalledWith(
    "hardwareBackPress",
    expect.any(Function)
  );
  expect(mocks.back?.({ type: "hardwareBackPress", timeStamp: 0 })).toBe(true);
  expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith();
  expect(onBack).not.toHaveBeenCalled();
  expect(mocks.exit).not.toHaveBeenCalled();
  dispose();
  expect(mocks.backRemove).toHaveBeenCalledOnce();
});

test.each([true, false])(
  "Android returns the navigation result %s without exiting",
  (result) => {
    mocks.platform = "android";
    const onBack = vi.fn<() => boolean>().mockReturnValue(result);
    const dispose = subscribeAndroidBack(onBack);
    expect(mocks.back?.({ type: "hardwareBackPress", timeStamp: 0 })).toBe(
      result
    );
    expect(onBack).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(mocks.exit).not.toHaveBeenCalled();
    dispose();
  }
);

test("disposed Android back handlers do not navigate or dismiss the keyboard", () => {
  mocks.platform = "android";
  mocks.visible.mockReturnValue(true);
  const onBack = vi.fn<() => boolean>();
  const dispose = subscribeAndroidBack(onBack);
  dispose();
  dispose();
  expect(mocks.back?.({ type: "hardwareBackPress", timeStamp: 0 })).toBe(false);
  expect(mocks.backRemove).toHaveBeenCalledOnce();
  expect(mocks.visible).not.toHaveBeenCalled();
  expect(mocks.dismiss).not.toHaveBeenCalled();
  expect(onBack).not.toHaveBeenCalled();
});

test.each(["ios", "web"])("%s back subscriptions are inert", (platform) => {
  mocks.platform = platform;
  const onBack = vi.fn<() => boolean>();
  subscribeAndroidBack(onBack)();
  expect(mocks.backAdd).not.toHaveBeenCalled();
  expect(mocks.visible).not.toHaveBeenCalled();
  expect(onBack).not.toHaveBeenCalled();
});

test("ignored warm OAuth/external events do not supersede a valid delayed startup locator", async () => {
  const pending = Promise.withResolvers<string | null>();
  mocks.initial.mockReturnValue(pending.promise);
  const onLink = vi
    .fn<Parameters<typeof subscribeContentLinks>[0]>()
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(false)
    .mockReturnValue(true);
  const onError = vi.fn<() => void>();
  const dispose = subscribeContentLinks(onLink, onError);
  mocks.warm?.({ url: "zoen://?cookie=opaque-callback" });
  mocks.warm?.({ url: "https://external.example/a/../b" });
  pending.resolve("zoen://companion/owned-session");
  await pending.promise;
  expect(onLink.mock.calls).toEqual([
    ["zoen://?cookie=opaque-callback", "event"],
    ["https://external.example/a/../b", "event"],
    ["zoen://companion/owned-session", "initial"],
  ]);
  expect(onError).not.toHaveBeenCalled();
  dispose();
});

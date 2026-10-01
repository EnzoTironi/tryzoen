import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  PanResponderCallbacks,
  PanResponderGestureState,
} from "react-native";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageInteraction } from "./interaction";

const state = vi.hoisted(() => ({
  reduced: false,
  callbacks: undefined as PanResponderCallbacks | undefined,
  touch: undefined as ComponentProps<
    typeof import("react-native").View
  >["onTouchStart"],
  spring: vi.fn<() => void>(),
  set: vi.fn<(value: number) => void>(),
}));
vi.mock("react-native", async () => {
  const native =
    await vi.importActual<typeof import("react-native")>("react-native-web");
  return {
    ...native,
    Platform: { ...native.Platform, OS: "ios" },
    useColorScheme: () => "light",
    View: (props: ComponentProps<typeof import("react-native").View>) => {
      if (props.onTouchStart) state.touch = props.onTouchStart;
      return <div>{props.children}</div>;
    },
    PanResponder: {
      create: (callbacks: PanResponderCallbacks) => {
        state.callbacks = callbacks;
        return { panHandlers: {} };
      },
    },
    Animated: {
      View: (props: ComponentProps<typeof import("react-native").View>) => (
        <div>{props.children}</div>
      ),
      Value: class {
        setValue = state.set;
        stopAnimation = vi.fn<() => void>();
        interpolate() {
          return 0;
        }
      },
      spring: () => ({ start: state.spring }),
    },
  };
});
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("../theme", async (original) => ({
  ...(await original<typeof import("../theme")>()),
  useAccessibilityPreferences: () => ({
    reduceMotion: state.reduced,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  }),
}));
vi.mock("./double-tap", () => ({
  useDoubleTapReaction: () => ({
    start: () => undefined,
    move: () => undefined,
    end: () => false,
    cancel: () => undefined,
    status: undefined,
    react: undefined,
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.reduced = false;
  state.callbacks = undefined;
  state.touch = undefined;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const event = {
  nativeEvent: { touches: [{ pageX: 0, pageY: 0 }] },
  target: null,
};
const gesture = (dx: number, dy = 0, numberActiveTouches = 1) =>
  ({
    dx,
    dy,
    numberActiveTouches,
    stateID: 1,
    moveX: dx,
    moveY: dy,
    x0: 0,
    y0: 0,
    vx: 0,
    vy: 0,
  }) satisfies PanResponderGestureState;
function mount(disabled = false) {
  const reply = vi.fn<ComponentProps<typeof MessageInteraction>["onReply"]>();
  renderToStaticMarkup(
    <MessageInteraction
      onReply={reply}
      outgoing={false}
      disabled={disabled}
      footer={<span>Replies</span>}
    >
      <span>Original message</span>
    </MessageInteraction>
  );
  if (!state.touch || !state.callbacks)
    throw new Error("Message gesture handlers missing");
  Reflect.apply(state.touch, undefined, [event]);
  const invoke = (
    name: keyof PanResponderCallbacks,
    value: PanResponderGestureState
  ) => {
    const handler = state.callbacks?.[name];
    if (typeof handler !== "function")
      throw new Error("Missing gesture callback");
    const result: unknown = Reflect.apply(handler, undefined, [event, value]);
    return result;
  };
  return { reply, invoke };
}

it.each([false, true])(
  "tracks a reply gesture and preserves its threshold with reduced motion %s",
  (reduced) => {
    state.reduced = reduced;
    const { reply, invoke } = mount();
    expect(invoke("onMoveShouldSetPanResponder", gesture(20))).toBe(true);
    invoke("onPanResponderMove", gesture(55));
    expect(state.set).toHaveBeenCalledWith(55);
    invoke("onPanResponderRelease", gesture(55));
    expect(reply).toHaveBeenCalledOnce();
    expect(state.set).toHaveBeenLastCalledWith(reduced ? 0 : 55);
    expect(state.spring).toHaveBeenCalledTimes(reduced ? 0 : 1);
  }
);
it.each([false, true])(
  "restores cancelled and short gestures without replying, reduced motion %s",
  (reduced) => {
    state.reduced = reduced;
    const { reply, invoke } = mount();
    expect(invoke("onMoveShouldSetPanResponder", gesture(25, 20))).toBe(false);
    expect(invoke("onMoveShouldSetPanResponder", gesture(25, 0, 2))).toBe(
      false
    );
    invoke("onPanResponderRelease", gesture(30));
    invoke("onPanResponderTerminate", gesture(80));
    expect(reply).not.toHaveBeenCalled();
    expect(state.set.mock.calls).toEqual(reduced ? [[0], [0]] : []);
    expect(state.spring).toHaveBeenCalledTimes(reduced ? 0 : 2);
  }
);
it("keeps disabled messages from claiming a reply gesture", () => {
  const { invoke } = mount(true);
  expect(invoke("onMoveShouldSetPanResponder", gesture(80))).toBe(false);
});

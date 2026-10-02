import { renderToSourceMarkup as renderToStaticMarkup } from "../../../tests/helpers/companion-i18n";
import type {
  PanResponderCallbacks,
  PanResponderGestureState,
  GestureResponderEvent,
} from "react-native";
import { beforeEach, expect, it, vi } from "vitest";
import { useSheetDrag } from "./sheet-drag";

const state = vi.hoisted(() => ({
  callbacks: {} as PanResponderCallbacks,
  reset: vi.fn<() => void>(),
  set: vi.fn<(value: number) => void>(),
  reduced: false,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  View: "div",
  StyleSheet: { create: <T,>(value: T) => value },
  PanResponder: {
    create: (callbacks: PanResponderCallbacks) => {
      state.callbacks = callbacks;
      return { panHandlers: {} };
    },
  },
  Animated: {
    Value: class {
      setValue = state.set;
      stopAnimation = vi.fn<() => void>();
    },
    spring: () => ({ start: state.reset }),
  },
}));
vi.mock("./theme", async (original) => ({
  ...(await original<typeof import("./theme")>()),
  useAccessibilityPreferences: () => ({
    reduceMotion: state.reduced,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.reduced = false;
});
function mount(enabled: boolean) {
  const close = vi.fn<() => void>();
  function Probe() {
    useSheetDrag(enabled, close);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return close;
}
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The drag callbacks consume gesture state only; the synthetic native event is not inspected.
const event = {} as GestureResponderEvent;
const motion = (dy: number, dx = 0, vy = 0, numberActiveTouches = 1) =>
  ({
    dy,
    dx,
    vy,
    numberActiveTouches,
    stateID: 1,
    moveX: dx,
    moveY: dy,
    x0: 0,
    y0: 0,
    vx: 0,
  }) satisfies PanResponderGestureState;
it("only claims downward, single-finger drags and keeps desktop dialogs stationary", () => {
  mount(true);
  expect(state.callbacks.onMoveShouldSetPanResponder?.(event, motion(20))).toBe(
    true
  );
  expect(
    state.callbacks.onMoveShouldSetPanResponder?.(event, motion(-20))
  ).toBe(false);
  expect(
    state.callbacks.onMoveShouldSetPanResponder?.(event, motion(20, 30))
  ).toBe(false);
  expect(
    state.callbacks.onMoveShouldSetPanResponder?.(event, motion(20, 0, 0, 2))
  ).toBe(false);
  mount(false);
  expect(
    state.callbacks.onMoveShouldSetPanResponder?.(event, motion(100))
  ).toBe(false);
});
it("dismisses deliberate distance or velocity but restores short and cancelled drags", () => {
  const close = mount(true);
  state.callbacks.onPanResponderRelease?.(event, motion(30));
  state.callbacks.onPanResponderTerminate?.(event, motion(120));
  expect(close).not.toHaveBeenCalled();
  state.callbacks.onPanResponderRelease?.(event, motion(90));
  state.callbacks.onPanResponderRelease?.(event, motion(30, 0, 1));
  expect(close).toHaveBeenCalledTimes(2);
  expect(state.reset).toHaveBeenCalled();
});

it("keeps direct drag tracking but resets immediately when motion is reduced", () => {
  state.reduced = true;
  const close = mount(true);
  state.callbacks.onPanResponderMove?.(event, motion(35));
  expect(state.set).toHaveBeenCalledWith(35);
  state.callbacks.onPanResponderRelease?.(event, motion(35));
  expect(close).not.toHaveBeenCalled();
  expect(state.set).toHaveBeenLastCalledWith(0);
  state.callbacks.onPanResponderRelease?.(event, motion(90));
  expect(close).toHaveBeenCalledOnce();
  expect(state.set).toHaveBeenLastCalledWith(0);
  expect(state.reset).not.toHaveBeenCalled();
});

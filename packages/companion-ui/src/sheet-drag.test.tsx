import { renderToStaticMarkup } from "react-dom/server";
import type {
  PanResponderCallbacks,
  PanResponderGestureState,
  GestureResponderEvent,
} from "react-native";
import { expect, it, vi } from "vitest";
import { useSheetDrag } from "./sheet-drag";

const state = vi.hoisted(() => ({
  callbacks: {} as PanResponderCallbacks,
  reset: vi.fn<() => void>(),
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
      setValue = vi.fn<(value: number) => void>();
      stopAnimation = vi.fn<() => void>();
    },
    spring: () => ({ start: state.reset }),
  },
}));
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

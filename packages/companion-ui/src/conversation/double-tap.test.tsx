import { useEffect, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GestureResponderEvent } from "react-native";
import { afterEach, expect, it, vi } from "vitest";
import { useDoubleTap } from "./double-tap";

vi.mock("./gesture-preferences", () => ({ useQuickReaction: () => "❤️" }));
const effects: EffectCallback[] = [];
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: EffectCallback) => {
    effects.push(effect);
  },
}));
afterEach(() => vi.useRealTimers());
function gesture(enabled = true) {
  const react = vi.fn<() => void>();
  let tap: ReturnType<typeof useDoubleTap> | undefined;
  function Probe() {
    const value = useDoubleTap(enabled ? react : undefined);
    useEffect(() => {
      tap = value;
    }, [value]);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  for (const effect of effects.splice(0)) effect();
  if (!tap) throw new Error("Gesture did not mount");
  return { tap, react };
}
const event = (x = 20, y = 20, count = 1) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Touch fixture intentionally supplies only the event fields consumed by this gesture.
  ({
    nativeEvent: {
      // Browser TouchEvent has coordinates on its touches, not on the event.
      touches: Array.from({ length: count }, () => ({ pageX: x, pageY: y })),
    },
  }) as GestureResponderEvent;
it("reacts once for each deliberate pair, never on a lone tap or the third tap", () => {
  vi.useFakeTimers();
  const { tap, react } = gesture();
  tap.start(event());
  tap.end();
  expect(react).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  tap.start(event(22, 21));
  expect(tap.end()).toBe(true);
  expect(react).toHaveBeenCalledTimes(1);
  tap.start(event());
  tap.end();
  expect(react).toHaveBeenCalledTimes(1);
});
it("scrolls, long presses, distant taps, multitouch and cancellation cannot complete a reaction", () => {
  vi.useFakeTimers();
  const { tap, react } = gesture();
  tap.start(event());
  tap.end();
  tap.start(event());
  tap.move(event(20, 40));
  tap.end();
  tap.start(event());
  tap.end();
  tap.start(event());
  vi.advanceTimersByTime(500);
  tap.end();
  tap.start(event());
  tap.end();
  tap.start(event(100, 100));
  tap.end();
  tap.start(event(20, 20, 2));
  tap.end();
  tap.start(event());
  tap.cancel();
  tap.end();
  tap.start(event());
  tap.end();
  expect(react).not.toHaveBeenCalled();
});
it("respects a disabled preference and rejects a second tap after the gesture window", () => {
  vi.useFakeTimers();
  const disabled = gesture(false);
  disabled.tap.start(event());
  disabled.tap.end();
  disabled.tap.start(event());
  disabled.tap.end();
  expect(disabled.react).not.toHaveBeenCalled();
  const { tap, react } = gesture();
  tap.start(event());
  tap.end();
  vi.advanceTimersByTime(400);
  tap.start(event());
  tap.end();
  expect(react).not.toHaveBeenCalled();
});

import { useRef, useState } from "react";
import { useQuickReaction } from "./gesture-preferences";
import type { GestureResponderEvent } from "react-native";

/** Touch only: mouse double-click keeps text selection and interactive children keep their actions. */
export function useDoubleTap(onDoubleTap?: () => void) {
  const origin = useRef<{ x: number; y: number; at: number } | undefined>(
    undefined
  );
  const previous = useRef<typeof origin.current>(undefined);
  const cancel = () => {
    origin.current = undefined;
    previous.current = undefined;
  };
  return {
    cancel,
    start(event: GestureResponderEvent) {
      const touch = event.nativeEvent.touches[0];
      if (!onDoubleTap || !touch || event.nativeEvent.touches.length !== 1) {
        cancel();
        return;
      }
      origin.current = {
        x: touch.pageX,
        y: touch.pageY,
        at: Date.now(),
      };
    },
    move(event: GestureResponderEvent) {
      const start = origin.current;
      const touch = event.nativeEvent.touches[0];
      if (
        start &&
        (!touch ||
          event.nativeEvent.touches.length !== 1 ||
          Math.hypot(touch.pageX - start.x, touch.pageY - start.y) > 8)
      )
        cancel();
    },
    end() {
      const start = origin.current;
      const last = previous.current;
      origin.current = undefined;
      if (!start || Date.now() - start.at > 220) {
        previous.current = undefined;
        return false;
      }
      if (
        last &&
        start.at - last.at <= 320 &&
        Math.hypot(start.x - last.x, start.y - last.y) < 24
      ) {
        previous.current = undefined;
        onDoubleTap?.();
        return true;
      } else previous.current = start;
      return false;
    },
  };
}

export function useDoubleTapReaction(
  onReact: ((emoji: string) => Promise<void>) | undefined,
  selected: string | null | undefined,
  disabled: boolean
) {
  const emoji = useQuickReaction();
  const busy = useRef(false);
  const [status, setStatus] = useState<"pending" | "failed">();
  const react = async () => {
    if (!emoji || !onReact || disabled || busy.current || selected === emoji)
      return;
    busy.current = true;
    setStatus("pending");
    try {
      await onReact(emoji);
      setStatus(undefined);
    } catch {
      setStatus("failed");
    } finally {
      busy.current = false;
    }
  };
  const tap = useDoubleTap(
    emoji && onReact && !disabled
      ? () => {
          void react();
        }
      : undefined
  );
  return { ...tap, status };
}

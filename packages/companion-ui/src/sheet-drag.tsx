import { colors } from "./theme";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Platform,
  View,
  StyleSheet,
} from "react-native";

/** Only the grabber owns the gesture, so document selection and scroll views keep theirs. */
export function useSheetDrag(enabled: boolean, onClose: () => void) {
  const [offset] = useState(() => new Animated.Value(0));
  const current = useRef({ enabled, onClose });
  const reduced = useRef(false);
  useEffect(() => {
    current.current = { enabled, onClose };
    if (!enabled) offset.setValue(0);
  }, [enabled, onClose, offset]);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) reduced.current = value;
    });
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => {
        reduced.current = value;
      }
    );
    return () => {
      mounted = false;
      listener.remove();
      offset.stopAnimation();
    };
  }, [offset]);
  const pan = useMemo(() => {
    const reset = () => {
      if (reduced.current) offset.setValue(0);
      else
        Animated.spring(offset, {
          toValue: 0,
          speed: 32,
          bounciness: 0,
          useNativeDriver: Platform.OS !== "web",
        }).start();
    };
    // oxlint-disable-next-line react/refs, hooks/refs -- Registers gesture callbacks; refs are read only when the grabber receives an event.
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        current.current.enabled &&
        gesture.numberActiveTouches === 1 &&
        gesture.dy > 8 &&
        gesture.dy > Math.abs(gesture.dx) * 2,
      onPanResponderGrant: () => {
        offset.stopAnimation();
      },
      onPanResponderMove: (_event, gesture) => {
        offset.setValue(Math.max(0, Math.min(240, gesture.dy)));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (
          current.current.enabled &&
          (gesture.dy >= 80 || (gesture.dy >= 28 && gesture.vy > 0.65))
        )
          current.current.onClose();
        // A pending operation may veto onClose; never leave that sheet offscreen.
        reset();
      },
      onPanResponderTerminate: reset,
      onPanResponderTerminationRequest: () => true,
    });
  }, [offset]);
  return { offset, handlers: pan.panHandlers };
}

export function SheetGrabber({
  handlers,
}: {
  readonly handlers: ReturnType<typeof useSheetDrag>["handlers"];
}) {
  return (
    <View
      {...handlers}
      style={styles.grabber}
      testID="sheet-grabber"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      <View style={styles.handle} />
    </View>
  );
}
const styles = StyleSheet.create({
  grabber: {
    height: 44,
    marginTop: -12,
    paddingTop: 12,
    width: "100%",
    ...(Platform.OS === "web" ? { touchAction: "none" as const } : {}),
  },
  handle: {
    width: 48,
    height: 4,
    borderRadius: 3,
    backgroundColor: colors.line,
    alignSelf: "center",
  },
});

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  type LayoutRectangle,
} from "react-native";
import { Reply } from "lucide-react-native";
import { useDoubleTapReaction } from "./double-tap";
import { systemFont, useAccessibilityPreferences, useColors } from "../theme";

const MessageInteractionContext = createContext<
  | {
      anchor?: LayoutRectangle;
      active: boolean;
      open: () => void;
      close: () => void;
      react?: (emoji: string | null) => void;
    }
  | undefined
>(undefined);

export function useMessageInteraction() {
  return useContext(MessageInteractionContext);
}

/** One interaction surface for private chat, groups and threads. Vertical scrolling wins. */
export function MessageInteraction({
  children,
  footer,
  onReply,
  onQuickReact,
  reaction,
  outgoing,
  disabled = false,
}: {
  readonly children: ReactNode;
  readonly footer: ReactNode;
  readonly onReply: () => void;
  readonly reaction?: string | null;
  readonly onQuickReact?: (emoji: string | null) => Promise<void>;
  readonly outgoing: boolean;
  readonly disabled?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const bubble = useRef<View>(null);
  const tap = useDoubleTapReaction(onQuickReact, reaction, disabled);
  const [offset] = useState(() => new Animated.Value(0));
  const reply = useRef(onReply);
  const inactive = useRef(disabled);
  const { reduceMotion } = useAccessibilityPreferences();
  const motion = useRef(reduceMotion);
  useLayoutEffect(() => {
    motion.current = reduceMotion;
  }, [reduceMotion]);
  const held = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);
  const suppressClick = useRef(false);
  const [anchor, setAnchor] = useState<LayoutRectangle>();
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    reply.current = onReply;
    inactive.current = disabled;
  }, [onReply, disabled]);
  useEffect(
    () => () => {
      clearTimeout(held.current);
      offset.stopAnimation();
    },
    [offset]
  );
  const open = useCallback(() => {
    if (inactive.current) return;
    bubble.current?.measureInWindow((x, y, width, height) => {
      if (width && height) setAnchor({ x, y, width, height });
    });
  }, []);
  const reset = useCallback(() => {
    clearTimeout(held.current);
    if (motion.current) offset.setValue(0);
    else
      Animated.spring(offset, {
        toValue: 0,
        useNativeDriver: Platform.OS !== "web",
        speed: 32,
        bounciness: 0,
      }).start();
  }, [offset]);
  const pan = useMemo(
    () =>
      // oxlint-disable-next-line react/refs, hooks/refs -- Registers callbacks; PanResponder reads these refs only in response to touch events.
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !inactive.current &&
          !!origin.current &&
          gesture.numberActiveTouches === 1 &&
          gesture.dx > 14 &&
          gesture.dx > Math.abs(gesture.dy) * 2,
        onPanResponderGrant: () => {
          clearTimeout(held.current);
          offset.stopAnimation();
          suppressClick.current = true;
        },
        onPanResponderMove: (_event, gesture) => {
          offset.setValue(Math.max(0, Math.min(72, gesture.dx)));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (
            !inactive.current &&
            gesture.dx >= 52 &&
            Math.abs(gesture.dy) < 72
          )
            reply.current();
          reset();
        },
        onPanResponderTerminate: reset,
        onPanResponderTerminationRequest: () => true,
      }),
    [offset, reset]
  );
  const webEvents =
    Platform.OS === "web"
      ? {
          onContextMenu: (event: MouseEvent) => {
            if (disabled || interactiveTarget(event.target)) return;
            event.preventDefault();
            open();
          },
          onKeyDown: (event: KeyboardEvent) => {
            if (
              (event.shiftKey && event.key === "F10") ||
              event.key === "ContextMenu"
            ) {
              event.preventDefault();
              open();
            }
          },
        }
      : {};
  const interaction = useMemo(
    () => ({
      anchor,
      active: hovered || !!anchor,
      open,
      close: () => {
        setAnchor(undefined);
      },
      react: tap.react,
    }),
    [anchor, hovered, open, tap.react]
  );
  return (
    <MessageInteractionContext value={interaction}>
      <View
        onTouchEndCapture={(event) => {
          // Prevent the compatibility click from landing on a newly opened sheet.
          if (Platform.OS === "web" && suppressClick.current)
            event.preventDefault();
          suppressClick.current = false;
        }}
        style={[styles.root, outgoing && styles.outgoing]}
        onPointerEnter={(event) => {
          if (event.nativeEvent.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={() => {
          setHovered(false);
        }}
      >
        <View style={styles.bubble}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.reply,
              {
                opacity: offset.interpolate({
                  inputRange: [0, 36, 52],
                  outputRange: [0, 0.4, 1],
                  extrapolate: "clamp",
                }),
              },
            ]}
          >
            <Reply size={18} color={colors.muted} />
          </Animated.View>
          <Animated.View
            style={{ transform: [{ translateX: offset }] }}
            {...pan.panHandlers}
          >
            <View
              ref={bubble}
              collapsable={false}
              {...webEvents}
              accessibilityActions={
                disabled
                  ? []
                  : [
                      { name: "reply", label: "Responder à mensagem" },
                      { name: "menu", label: "Ações da mensagem" },
                    ]
              }
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "reply") onReply();
                else open();
              }}
              onTouchStart={(event) => {
                const touch = event.nativeEvent.touches[0];
                clearTimeout(held.current);
                suppressClick.current = false;
                if (
                  disabled ||
                  !touch ||
                  event.nativeEvent.touches.length !== 1 ||
                  interactiveTarget(event.target)
                ) {
                  tap.cancel();
                  return;
                }
                tap.start(event);
                origin.current = {
                  x: touch.pageX,
                  y: touch.pageY,
                };
                held.current = setTimeout(() => {
                  suppressClick.current = true;
                  open();
                }, 480);
              }}
              onTouchMove={(event) => {
                tap.move(event);
                const touch = event.nativeEvent.touches[0];
                if (!origin.current || !touch) return;
                if (
                  Math.abs(touch.pageX - origin.current.x) > 8 ||
                  Math.abs(touch.pageY - origin.current.y) > 8
                )
                  clearTimeout(held.current);
              }}
              onTouchEnd={(event) => {
                if (tap.end() && Platform.OS === "web") event.preventDefault();
                clearTimeout(held.current);
                origin.current = undefined;
              }}
              onTouchCancel={() => {
                tap.cancel();
                clearTimeout(held.current);
                origin.current = undefined;
                reset();
              }}
              style={anchor ? styles.selected : undefined}
            >
              {children}
            </View>
          </Animated.View>
        </View>
        {tap.status === "pending" && (
          <ActivityIndicator
            accessibilityLabel="Salvando reação"
            size="small"
            style={styles.quickStatus}
          />
        )}
        {tap.status === "failed" && (
          <Text accessibilityRole="alert" style={styles.error}>
            Não foi possível salvar a reação. Tente novamente.
          </Text>
        )}
        {footer}
      </View>
    </MessageInteractionContext>
  );
}

function interactiveTarget(target: unknown) {
  return (
    Platform.OS === "web" &&
    target instanceof Element &&
    !!target.closest(
      "a,button,input,textarea,select,video,audio,[contenteditable=true]"
    )
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    quickStatus: { position: "absolute", right: 8, bottom: -4 },
    error: {
      fontFamily: systemFont,
      fontSize: 12,
      color: colors.danger,
      maxWidth: 260,
    },
    root: { maxWidth: "100%", alignItems: "flex-start", position: "relative" },
    outgoing: { alignItems: "flex-end" },
    bubble: { maxWidth: "100%" },
    selected: { borderRadius: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.12)" },
    reply: {
      position: "absolute",
      left: 6,
      top: "50%",
      marginTop: -16,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.wash,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}

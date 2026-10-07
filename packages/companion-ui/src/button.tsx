import { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import {
  radius,
  space,
  systemFont,
  useAccessibilityPreferences,
  useColors,
  useTypeScale,
  type TypeScale,
} from "./theme";

export function ActionButton({
  children,
  onPress,
  disabled = false,
  quiet = false,
}: {
  readonly children: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly quiet?: boolean;
}) {
  const colors = useColors();
  const type = useTypeScale();
  const styles = useMemo(() => createStyles(colors, type), [colors, type]);
  const { reduceMotion } = useAccessibilityPreferences();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => {
        setHovered(true);
      }}
      onHoverOut={() => {
        setHovered(false);
      }}
      style={({ pressed }) => [
        styles.action,
        quiet && styles.quiet,
        hovered && !disabled && (quiet ? styles.quietHover : styles.hover),
        pressed && styles.pressed,
        pressed && !reduceMotion && styles.pressedScale,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionText, quiet && styles.quietText]}>
        {children}
      </Text>
    </Pressable>
  );
}

function createStyles(colors: ReturnType<typeof useColors>, type: TypeScale) {
  return StyleSheet.create({
    pressed: { opacity: 0.72 },
    pressedScale: { transform: [{ scale: 0.98 }] },
    disabled: { opacity: 0.38 },
    action: {
      minHeight: 44,
      paddingVertical: space.sm + 2,
      paddingHorizontal: space.lg + 2,
      borderRadius: radius.pill,
      // The prominent style tints the background with the accent, as system
      // prominent buttons do; white label on #0a63d8 is 5.5:1 in both modes.
      backgroundColor: colors.selection,
      justifyContent: "center",
      alignItems: "center",
      outlineOffset: 2,
      ...(Platform.OS === "web"
        ? {
            transitionProperty: "background-color, box-shadow, transform",
            transitionDuration: "160ms",
            transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
            boxShadow: "0 1px 2px rgba(10,99,216,0.24)",
          }
        : {}),
    },
    hover: {
      backgroundColor: "#0856bd",
      ...(Platform.OS === "web"
        ? { boxShadow: "0 6px 16px -8px rgba(10,99,216,0.6)" }
        : {}),
    },
    quiet: {
      backgroundColor: colors.wash,
      ...(Platform.OS === "web" ? { boxShadow: "none" } : {}),
    },
    quietHover: { backgroundColor: colors.line },
    actionText: {
      fontFamily: systemFont,
      ...type.callout,
      fontWeight: "600",
      color: colors.selectedInk,
    },
    quietText: { color: colors.ink },
  });
}

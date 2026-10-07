import { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import { radius, space, systemFont, typeScale, useColors } from "./theme";

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
  const styles = useMemo(() => createStyles(colors), [colors]);
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
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionText, quiet && styles.quietText]}>
        {children}
      </Text>
    </Pressable>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
    disabled: { opacity: 0.38 },
    action: {
      minHeight: 44,
      paddingVertical: space.sm + 2,
      paddingHorizontal: space.lg + 2,
      borderRadius: radius.pill,
      backgroundColor: colors.ink,
      justifyContent: "center",
      alignItems: "center",
      outlineOffset: 2,
      ...(Platform.OS === "web"
        ? {
            transitionProperty: "background-color, box-shadow, transform",
            transitionDuration: "160ms",
            transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
            boxShadow: "0 1px 2px rgba(16,24,40,0.12)",
          }
        : {}),
    },
    hover: {
      ...(Platform.OS === "web"
        ? { boxShadow: "0 6px 16px -6px rgba(16,24,40,0.45)" }
        : {}),
      transform: [{ translateY: -1 }],
    },
    quiet: {
      backgroundColor: colors.wash,
      ...(Platform.OS === "web" ? { boxShadow: "none" } : {}),
    },
    quietHover: { backgroundColor: colors.line },
    actionText: {
      fontFamily: systemFont,
      ...typeScale.callout,
      fontWeight: "600",
      color: colors.surface,
    },
    quietText: { color: colors.ink },
  });
}

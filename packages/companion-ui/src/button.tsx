import { useMemo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { systemFont, useColors } from "./theme";

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
  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        quiet && styles.quiet,
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
    pressed: { opacity: 0.65 },
    disabled: { opacity: 0.35 },
    action: {
      minHeight: 42,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 24,
      backgroundColor: colors.ink,
      justifyContent: "center",
      alignItems: "center",
    },
    quiet: { backgroundColor: colors.wash },
    actionText: {
      fontFamily: systemFont,
      fontSize: 14,
      fontWeight: "500",
      color: colors.surface,
    },
    quietText: { color: colors.ink },
  });
}

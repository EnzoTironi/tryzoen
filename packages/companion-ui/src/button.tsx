import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "./theme";

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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
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

const styles = StyleSheet.create({
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
  actionText: { fontSize: 14, fontWeight: "500", color: colors.surface },
  quietText: { color: colors.ink },
});

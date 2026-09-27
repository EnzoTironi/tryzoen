import type { ComponentType } from "react";
import { Pressable, StyleSheet } from "react-native";
import type { LucideProps } from "lucide-react-native";
import { colors } from "./theme";

export function IconButton({
  label,
  icon: Icon,
  onPress,
  selected = false,
  disabled = false,
}: {
  readonly label: string;
  readonly icon: ComponentType<LucideProps>;
  readonly onPress: () => void;
  readonly selected?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.icon,
        selected && styles.selected,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon size={24} strokeWidth={1.8} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  selected: {
    backgroundColor: colors.wash,
    boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
  },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.35 },
});

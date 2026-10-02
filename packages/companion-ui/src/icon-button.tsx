import type { ComponentType } from "react";
import { Pressable, StyleSheet } from "react-native";
import type { LucideProps } from "lucide-react-native";
import { useColors } from "./theme";

export function IconButton({
  label,
  icon: Icon,
  onPress,
  selected = false,
  disabled = false,
  quiet = false,
}: {
  readonly label: string;
  readonly icon: ComponentType<LucideProps>;
  readonly onPress: () => void;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly quiet?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      hitSlop={2}
      onPress={onPress}
      style={({ pressed }) => [
        styles.icon,
        selected && { backgroundColor: colors.wash },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon
        size={quiet ? 19 : 24}
        strokeWidth={1.8}
        color={selected ? colors.accent : quiet ? colors.muted : colors.ink}
      />
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
    outlineOffset: 2,
  },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.35 },
});

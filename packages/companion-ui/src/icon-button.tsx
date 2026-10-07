import type { ComponentType } from "react";
import { useState } from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
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
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      hitSlop={2}
      onPress={onPress}
      onHoverIn={() => {
        setHovered(true);
      }}
      onHoverOut={() => {
        setHovered(false);
      }}
      style={({ pressed }) => [
        styles.icon,
        hovered && !disabled && { backgroundColor: colors.wash },
        selected && { backgroundColor: colors.accentSoft },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon
        size={quiet ? 19 : 22}
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
    ...(Platform.OS === "web"
      ? {
          transitionProperty: "background-color, transform",
          transitionDuration: "140ms",
        }
      : {}),
  },
  pressed: { opacity: 0.65, transform: [{ scale: 0.94 }] },
  disabled: { opacity: 0.35 },
});

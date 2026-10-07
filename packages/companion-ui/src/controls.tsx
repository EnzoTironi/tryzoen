import type { ComponentType } from "react";
import { useMemo } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
  type SwitchProps,
} from "react-native";
import type { LucideProps } from "lucide-react-native";
import {
  useAccessibilityPreferences,
  useColors,
  useDarkAppearance,
} from "./theme";

/**
 * Icon segmented control in the iOS 26 style: a quiet fill track with a raised
 * thumb on the selected segment. The thumb lifts slightly while pressed, the
 * transient emphasis Apple gives content-layer controls, unless Reduce Motion
 * is on. Each segment keeps a 44 pt hit region.
 */
export function SegmentedControl<Value extends string>({
  options,
  value,
  onChange,
}: {
  readonly options: readonly {
    readonly value: Value;
    readonly label: string;
    readonly icon: ComponentType<LucideProps>;
  }[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}) {
  const colors = useColors();
  const dark = useDarkAppearance();
  const { reduceMotion, increasedContrast, forcedColors } =
    useAccessibilityPreferences();
  const strong = increasedContrast || forcedColors;
  const styles = useMemo(
    () => createStyles(colors, dark, strong),
    [colors, dark, strong]
  );
  return (
    <View accessibilityRole="radiogroup" style={styles.track}>
      {options.map(({ value: option, label, icon: Icon }) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            hitSlop={{ top: 6, bottom: 6 }}
            onPress={() => {
              if (!selected) onChange(option);
            }}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.thumb,
              selected && pressed && !reduceMotion && styles.lifted,
              !selected && pressed && styles.pressed,
            ]}
          >
            <Icon
              size={18}
              strokeWidth={selected ? 2 : 1.8}
              color={selected ? colors.ink : colors.muted}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** System switch tinted with the Zoen accent, with a defined off track. */
export function Toggle(props: Omit<SwitchProps, "trackColor" | "thumbColor">) {
  const colors = useColors();
  return (
    <Switch
      {...props}
      trackColor={{ false: colors.line, true: colors.accent }}
      thumbColor="#ffffff"
      {...(Platform.OS === "web"
        ? { activeThumbColor: "#ffffff", activeTrackColor: colors.accent }
        : { ios_backgroundColor: colors.line })}
    />
  );
}

function createStyles(
  colors: ReturnType<typeof useColors>,
  dark: boolean,
  strong: boolean
) {
  return StyleSheet.create({
    track: {
      flexDirection: "row",
      alignItems: "center",
      padding: 2,
      gap: 2,
      borderRadius: 18,
      backgroundColor: colors.wash,
      borderWidth: strong ? 1 : 0,
      borderColor: colors.ink,
    },
    segment: {
      width: 40,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      outlineOffset: 2,
      ...(Platform.OS === "web"
        ? {
            transitionProperty: "background-color, box-shadow, transform",
            transitionDuration: "180ms",
          }
        : {}),
    },
    thumb: {
      backgroundColor: dark ? "#2c3038" : colors.surface,
      borderWidth: strong ? 1 : 0,
      borderColor: colors.ink,
      boxShadow: dark
        ? "inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.45)"
        : "inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 3px rgba(16,24,40,0.14), 0 0 0 0.5px rgba(16,24,40,0.06)",
    },
    lifted: { transform: [{ scale: 1.06 }] },
    pressed: { opacity: 0.6 },
  });
}

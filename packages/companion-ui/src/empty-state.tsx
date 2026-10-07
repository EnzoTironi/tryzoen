import type { ComponentType } from "react";
import { useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { LucideProps } from "lucide-react-native";
import { ActionButton } from "./button";
import { radius, space, systemFont, typeScale, useColors } from "./theme";

/**
 * The one empty state for companion collections: a tinted symbol, a short
 * invitation and at most two actions. Keeps every blank page purposeful.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  secondaryAction,
  compact = false,
}: {
  readonly icon: ComponentType<LucideProps>;
  readonly title: string;
  readonly body?: string;
  readonly action?: { readonly label: string; readonly onPress: () => void };
  readonly secondaryAction?: {
    readonly label: string;
    readonly onPress: () => void;
  };
  readonly compact?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View
      testID="empty-state"
      style={[styles.empty, compact && styles.compact]}
    >
      <View style={[styles.symbol, compact && styles.compactSymbol]}>
        <Icon
          size={compact ? 20 : 24}
          strokeWidth={1.7}
          color={colors.accent}
        />
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.title, compact && styles.compactTitle]}
      >
        {title}
      </Text>
      {body ? (
        <Text style={[styles.body, compact && styles.compactBody]}>{body}</Text>
      ) : null}
      {(action ?? secondaryAction) && (
        <View style={styles.actions}>
          {action && (
            <ActionButton onPress={action.onPress}>{action.label}</ActionButton>
          )}
          {secondaryAction && (
            <ActionButton quiet onPress={secondaryAction.onPress}>
              {secondaryAction.label}
            </ActionButton>
          )}
        </View>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    empty: {
      alignItems: "center",
      alignSelf: "center",
      width: "100%",
      maxWidth: 440,
      paddingVertical: space.xxxl,
      paddingHorizontal: space.lg,
    },
    compact: {
      alignItems: "flex-start",
      alignSelf: "stretch",
      maxWidth: undefined,
      paddingVertical: space.xl,
      paddingHorizontal: 0,
    },
    symbol: {
      width: 56,
      height: 56,
      borderRadius: radius.lg + 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
      marginBottom: space.xl,
      ...(Platform.OS === "web"
        ? { boxShadow: `0 0 0 6px ${colors.accentSoft}66` }
        : {}),
    },
    compactSymbol: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      marginBottom: space.lg,
      ...(Platform.OS === "web" ? { boxShadow: "none" } : {}),
    },
    title: {
      fontFamily: systemFont,
      ...typeScale.title,
      color: colors.ink,
      textAlign: "center",
    },
    compactTitle: { ...typeScale.headline, textAlign: "left" },
    body: {
      fontFamily: systemFont,
      ...typeScale.body,
      color: colors.muted,
      textAlign: "center",
      marginTop: space.sm,
    },
    compactBody: {
      ...typeScale.footnote,
      textAlign: "left",
      marginTop: space.xs,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: space.sm,
      marginTop: space.xl,
    },
  });
}

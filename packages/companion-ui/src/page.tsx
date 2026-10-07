import { useI18n } from "./i18n";
import { useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { ActionButton } from "./button";
import {
  radius,
  space,
  systemFont,
  useTypeScale,
  useColors,
  type TypeScale,
} from "./theme";

export function CompanionPage({
  title,
  children,
  actions,
  loading,
  error,
  onRetry,
  hideTitle = false,
  contentMaxWidth,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly loading?: boolean;
  readonly error?: string;
  readonly onRetry?: () => void;
  readonly hideTitle?: boolean;
  readonly contentMaxWidth?: number;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const type = useTypeScale();
  const styles = useMemo(() => createStyles(colors, type), [colors, type]);
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  const compact = width < 720;
  return (
    <ScrollView
      onLayout={({ nativeEvent }) => {
        setWidth(nativeEvent.layout.width);
      }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.scroll, compact && styles.compact]}
    >
      <View
        style={[
          styles.page,
          contentMaxWidth
            ? { maxWidth: contentMaxWidth, alignSelf: "center" }
            : undefined,
        ]}
      >
        {(!hideTitle || actions) &&
          (compact ? (
            // iOS large-title layout: trailing bar items on their own row,
            // the title below at full width so long names never wrap.
            <View style={styles.compactHeader}>
              <View style={styles.compactActions}>{actions}</View>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
            </View>
          ) : (
            <View style={styles.header}>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              {actions}
            </View>
          ))}
        {loading && (
          <ActivityIndicator
            accessibilityLabel={t("Loading {value1}", { value1: title })}
            color={colors.accent}
          />
        )}
        {error && (
          <View style={styles.error}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
            {onRetry && (
              <ActionButton quiet onPress={onRetry}>
                {t("Try again")}
              </ActionButton>
            )}
          </View>
        )}
        {children}
      </View>
    </ScrollView>
  );
}
export function usePageStyles() {
  const colors = useColors();
  const type = useTypeScale();
  return useMemo(
    () =>
      StyleSheet.create({
        heading: {
          fontFamily: systemFont,
          color: colors.ink,
          ...type.headline,
          marginBottom: space.lg,
        },
        copy: {
          fontFamily: systemFont,
          color: colors.muted,
          ...type.subhead,
        },
        row: {
          flexDirection: "row",
          alignItems: "center",
          gap: space.lg,
          paddingVertical: space.lg,
        },
        rowCopy: { flex: 1, gap: space.xs },
        rowTitle: {
          fontFamily: systemFont,
          color: colors.ink,
          ...type.body,
          fontWeight: "500",
        },
        field: {
          fontFamily: systemFont,
          backgroundColor: colors.wash,
          color: colors.ink,
          borderRadius: radius.md,
          paddingVertical: space.md,
          paddingHorizontal: space.lg - 2,
          fontSize: 16,
          marginBottom: space.xl,
          outlineWidth: 0,
        },
        section: { marginTop: space.xxl },
      }),
    [colors, type]
  );
}
function createStyles(colors: ReturnType<typeof useColors>, type: TypeScale) {
  return StyleSheet.create({
    scroll: {
      flexGrow: 1,
      paddingHorizontal: space.xxxl + space.lg,
      paddingTop: space.xxxl,
      paddingBottom: space.xxxl + space.md,
    },
    compact: {
      paddingHorizontal: space.lg + 2,
      paddingTop: space.sm,
      paddingBottom: space.xxl,
    },
    compactHeader: { marginBottom: space.xl },
    compactActions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      minHeight: 44,
      marginRight: -space.sm,
    },
    page: { width: "100%", maxWidth: 880, alignSelf: "center" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: space.lg,
      marginBottom: space.xxl,
      minHeight: 44,
    },
    title: {
      fontFamily: systemFont,
      ...type.largeTitle,
      color: colors.ink,
      flexShrink: 1,
    },
    error: {
      gap: space.md,
      marginBottom: space.xl,
      alignItems: "flex-start",
      padding: space.lg,
      borderRadius: radius.md,
      backgroundColor: colors.wash,
    },
    errorText: {
      fontFamily: systemFont,
      color: colors.danger,
      fontSize: 14,
      lineHeight: 20,
    },
  });
}

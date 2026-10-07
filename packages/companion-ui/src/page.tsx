import { useI18n } from "./i18n";
import { useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { ActionButton } from "./button";
import { radius, space, systemFont, typeScale, useColors } from "./theme";

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
  const styles = useMemo(() => createStyles(colors), [colors]);
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  const compact = width < 720;
  return (
    <ScrollView
      onLayout={({ nativeEvent }) => {
        setWidth(nativeEvent.layout.width);
      }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.scroll,
        compact && styles.compact,
        compact && Platform.OS === "web" && styles.compactWeb,
      ]}
    >
      <View
        style={[
          styles.page,
          contentMaxWidth
            ? { maxWidth: contentMaxWidth, alignSelf: "center" }
            : undefined,
        ]}
      >
        {(!hideTitle || actions) && (
          <View style={styles.header}>
            <Text
              accessibilityRole="header"
              style={[styles.title, compact && styles.compactTitle]}
            >
              {title}
            </Text>
            {actions}
          </View>
        )}
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
  return useMemo(
    () =>
      StyleSheet.create({
        heading: {
          fontFamily: systemFont,
          color: colors.ink,
          ...typeScale.headline,
          fontSize: 18,
          marginBottom: space.lg,
        },
        copy: {
          fontFamily: systemFont,
          color: colors.muted,
          ...typeScale.footnote,
          fontSize: 14,
          lineHeight: 20,
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
          ...typeScale.body,
          fontSize: 16,
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
    [colors]
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    scroll: {
      flexGrow: 1,
      paddingHorizontal: space.xxxl + space.lg,
      paddingTop: space.xxxl,
      paddingBottom: space.xxxl + space.md,
    },
    compact: {
      paddingHorizontal: space.lg + 2,
      paddingTop: space.lg,
      paddingBottom: space.xxl,
    },
    compactWeb: { paddingTop: space.xl + space.xs },
    compactTitle: {
      fontFamily: systemFont,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.7,
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
      ...typeScale.largeTitle,
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

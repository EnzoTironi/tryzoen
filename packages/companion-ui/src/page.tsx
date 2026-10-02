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
import { systemFont, useColors } from "./theme";

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
              style={[
                styles.title,
                compact && Platform.OS !== "web" && styles.compactTitle,
              ]}
            >
              {title}
            </Text>
            {actions}
          </View>
        )}
        {loading && (
          <ActivityIndicator
            accessibilityLabel={`Loading ${title}`}
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
                Try again
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
          fontSize: 20,
          fontWeight: "600",
          marginBottom: 20,
        },
        copy: {
          fontFamily: systemFont,
          color: colors.muted,
          fontSize: 14,
          lineHeight: 20,
        },
        row: {
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          paddingVertical: 16,
        },
        rowCopy: { flex: 1, gap: 5 },
        rowTitle: {
          fontFamily: systemFont,
          color: colors.ink,
          fontSize: 16,
          fontWeight: "500",
          lineHeight: 22,
        },
        field: {
          fontFamily: systemFont,
          backgroundColor: colors.wash,
          color: colors.ink,
          borderRadius: 16,
          padding: 14,
          fontSize: 16,
          marginBottom: 24,
          outlineWidth: 0,
        },
        section: { marginTop: 32 },
        empty: { gap: 20, paddingVertical: 24, alignItems: "flex-start" },
      }),
    [colors]
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    scroll: {
      flexGrow: 1,
      paddingHorizontal: 64,
      paddingTop: 44,
      paddingBottom: 60,
    },
    compact: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
    compactWeb: { paddingTop: 44 },
    compactTitle: {
      fontFamily: systemFont,
      fontSize: 24,
      lineHeight: 30,
      letterSpacing: -0.6,
    },
    page: { width: "100%", maxWidth: 1000, alignSelf: "flex-start" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      marginBottom: 32,
    },
    title: {
      fontFamily: systemFont,
      fontSize: 34,
      lineHeight: 40,
      fontWeight: "600",
      letterSpacing: -1.1,
      color: colors.ink,
      flexShrink: 1,
    },
    error: { gap: 12, marginBottom: 20, alignItems: "flex-start" },
    errorText: {
      fontFamily: systemFont,
      color: colors.danger,
      fontSize: 14,
      lineHeight: 20,
    },
  });
}

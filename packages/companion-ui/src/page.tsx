import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { ActionButton } from "./button";
import { colors } from "./theme";

export function CompanionPage({
  title,
  children,
  actions,
  loading,
  error,
  onRetry,
  hideTitle = false,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly loading?: boolean;
  readonly error?: string;
  readonly onRetry?: () => void;
  readonly hideTitle?: boolean;
}) {
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
      <View style={styles.page}>
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
export const pageStyles = StyleSheet.create({
  heading: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 20,
  },
  copy: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 16,
  },
  rowCopy: { flex: 1, gap: 5 },
  rowTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 22,
  },
  field: {
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
});
const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 64,
    paddingTop: 44,
    paddingBottom: 60,
  },
  compact: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  compactTitle: { fontSize: 24, lineHeight: 30, letterSpacing: -0.6 },
  page: { width: "100%", maxWidth: 1000, alignSelf: "flex-start" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 32,
  },
  title: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "600",
    letterSpacing: -1.1,
    color: colors.ink,
    flexShrink: 1,
  },
  error: { gap: 12, marginBottom: 20, alignItems: "flex-start" },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});

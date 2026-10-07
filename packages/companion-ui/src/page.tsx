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
import {
  radius,
  space,
  systemFont,
  useAccessibilityPreferences,
  useTypeScale,
  useColors,
  type TypeScale,
} from "./theme";
import { glassSurface, useGlass, type GlassMode } from "./glass";
import { useShellChrome } from "./shell-chrome";

/** Height of the compact navigation bar row that holds trailing actions. */
const barHeight = 52;

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
  const glass = useGlass();
  const { reduceMotion } = useAccessibilityPreferences();
  const chrome = useShellChrome();
  const styles = useMemo(
    () => createStyles(colors, type, glass),
    [colors, type, glass]
  );
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  const compact = width < 720;
  const titled = !hideTitle || Boolean(actions);
  // The large title scrolls under the bar; once it is gone the bar turns to
  // glass and shows the title inline, as iOS navigation bars do.
  const [scrolled, setScrolled] = useState(false);
  const collapseAt = compact ? 40 : 76;
  return (
    <View style={styles.frame}>
      <ScrollView
        onLayout={({ nativeEvent }) => {
          setWidth(nativeEvent.layout.width);
        }}
        onScroll={({ nativeEvent }) => {
          const offset = nativeEvent.contentOffset.y;
          const next = offset > collapseAt;
          if (next !== scrolled) setScrolled(next);
          chrome.onScroll?.(offset);
        }}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scroll,
          compact && styles.compact,
          compact && titled && styles.compactBelowBar,
          chrome.bottomInset > 0 && {
            paddingBottom: chrome.bottomInset + space.lg,
          },
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
          {titled &&
            (compact ? (
              // iOS large-title layout: trailing bar items live in the floating
              // bar above, the title below at full width so long names never wrap.
              <View style={styles.compactHeader}>
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
      {titled && (compact || scrolled) && (
        <View
          pointerEvents="box-none"
          style={[
            styles.bar,
            !compact && styles.desktopBar,
            scrolled && styles.barScrolled,
            !reduceMotion && styles.barMotion,
          ]}
        >
          {/* The inline title repeats the large title for sighted people
              only; assistive technology already has the heading above. */}
          <Text
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            numberOfLines={1}
            style={[
              styles.inlineTitle,
              !scrolled && styles.inlineTitleHidden,
              !reduceMotion && styles.inlineTitleMotion,
            ]}
          >
            {title}
          </Text>
          {compact && actions && (
            <View style={styles.barActions}>{actions}</View>
          )}
        </View>
      )}
    </View>
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
function createStyles(
  colors: ReturnType<typeof useColors>,
  type: TypeScale,
  glass: GlassMode
) {
  return StyleSheet.create({
    frame: { flex: 1, minHeight: 0 },
    // Navigation bar: transparent at rest so the page reads as one surface,
    // glass with a hairline edge once content scrolls beneath it.
    bar: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 20,
      minHeight: barHeight,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      paddingHorizontal: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "transparent",
      backgroundColor: "transparent",
    },
    desktopBar: { minHeight: 52, justifyContent: "center" },
    barScrolled: {
      ...glassSurface(colors, glass, {
        thickness: "thick",
        elevation: "none",
      }),
      borderWidth: 0,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    barMotion: {
      zIndex: 20,
      ...(Platform.OS === "web"
        ? {
            transitionProperty: "background-color, border-color",
            transitionDuration: "200ms",
          }
        : {}),
    },
    inlineTitle: {
      position: "absolute",
      left: 72,
      right: 72,
      textAlign: "center",
      fontFamily: systemFont,
      ...type.headline,
      color: colors.ink,
    },
    inlineTitleHidden: { opacity: 0 },
    inlineTitleMotion: {
      position: "absolute",
      ...(Platform.OS === "web"
        ? { transitionProperty: "opacity", transitionDuration: "200ms" }
        : {}),
    },
    // iOS 26 groups trailing bar buttons in one glass capsule.
    barActions: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 44,
      paddingHorizontal: 2,
      borderRadius: 24,
      ...glassSurface(colors, glass),
    },
    compactBelowBar: { paddingTop: barHeight },
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

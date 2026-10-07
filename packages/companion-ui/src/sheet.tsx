import { useI18n } from "./i18n";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react-native";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { CompanionOverlay } from "./overlay";
import { IconButton } from "./icon-button";
import { useSheetDrag, SheetGrabber } from "./sheet-drag";
import {
  elevation,
  radius,
  space,
  systemFont,
  typeScale,
  useColors,
} from "./theme";

/** One stable tree preserves drafts when a sheet becomes a desktop dialog. */
export function SheetSurface({
  title,
  onClose,
  children,
  panelStyle,
  maxWidth = 740,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly panelStyle?: StyleProp<ViewStyle>;
  readonly maxWidth?: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const compact = useWindowDimensions().width < 720;
  const drag = useSheetDrag(compact, onClose);
  return (
    <CompanionOverlay title={title} onClose={onClose}>
      <View style={[styles.backdrop, !compact && styles.desktopBackdrop]}>
        <Pressable
          accessible={false}
          tabIndex={-1}
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY: drag.offset }] },
            panelStyle,
            !compact && [styles.desktopPanel, { maxWidth }],
          ]}
        >
          {compact && <SheetGrabber handlers={drag.handlers} />}
          {children}
        </Animated.View>
      </View>
    </CompanionOverlay>
  );
}

export function CompanionSheet({
  title,
  onClose,
  children,
  scrollable = true,
  maxWidth,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly scrollable?: boolean;
  readonly maxWidth?: number;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SheetSurface title={title} onClose={onClose} maxWidth={maxWidth}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <IconButton
          label={t("Close {value1}", { value1: title.toLowerCase() })}
          icon={X}
          onPress={onClose}
        />
      </View>
      {scrollable ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.listContent]}>{children}</View>
      )}
    </SheetSurface>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: "flex-end",
      alignItems: "center",
      backgroundColor: "rgba(10,14,24,0.32)",
      ...(Platform.OS === "web" ? { backdropFilter: "blur(2px)" } : {}),
    },
    sheet: {
      width: "100%",
      maxHeight: "86%",
      backgroundColor: colors.canvas,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingTop: 12,
      overflow: "hidden",
    },
    desktopBackdrop: { justifyContent: "center", padding: 32 },
    desktopPanel: {
      borderRadius: radius.xl + 2,
      maxHeight: "90%",
      paddingTop: space.lg + 4,
      boxShadow: elevation.floating,
    },
    header: {
      paddingHorizontal: 24,
      paddingBottom: 16,
      flexDirection: "row",
      gap: 16,
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: {
      fontFamily: systemFont,
      flex: 1,
      ...typeScale.title,
      color: colors.ink,
    },
    content: { paddingHorizontal: 24, paddingBottom: 32, gap: 16 },
    listContent: { minHeight: 0, flexShrink: 1 },
  });
}

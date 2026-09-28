import type { ReactNode } from "react";
import { X } from "lucide-react-native";
import {
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
import { colors } from "./theme";

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
  const compact = useWindowDimensions().width < 720;
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
        <View
          style={[
            styles.sheet,
            panelStyle,
            !compact && [styles.desktopPanel, { maxWidth }],
          ]}
        >
          {compact && <View style={styles.handle} />}
          {children}
        </View>
      </View>
    </CompanionOverlay>
  );
}

export function CompanionSheet({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <SheetSurface title={title} onClose={onClose}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <IconButton
          label={`Close ${title.toLowerCase()}`}
          icon={X}
          onPress={onClose}
        />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        {children}
      </ScrollView>
    </SheetSurface>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    backgroundColor: "rgba(252,252,252,0.45)",
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
    borderRadius: 28,
    maxHeight: "90%",
    paddingTop: 20,
    boxShadow: "0 8px 48px rgba(0,0,0,0.12)",
  },
  handle: {
    width: 48,
    height: 4,
    borderRadius: 3,
    backgroundColor: colors.line,
    alignSelf: "center",
    marginBottom: 12,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { flex: 1, fontSize: 23, fontWeight: "600", color: colors.ink },
  content: { paddingHorizontal: 24, paddingBottom: 32, gap: 16 },
});

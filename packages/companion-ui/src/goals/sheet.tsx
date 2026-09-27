import type { ReactNode } from "react";
import { X } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CompanionOverlay } from "../overlay";
import { IconButton } from "../icon-button";
import { colors } from "../theme";

export function GoalSheet({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <CompanionOverlay title={title} onClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${title.toLowerCase()}`}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
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
        </View>
      </View>
    </CompanionOverlay>
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
    maxWidth: 740,
    maxHeight: "86%",
    backgroundColor: colors.canvas,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
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

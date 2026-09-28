import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Plus, X } from "lucide-react-native";
import { CompanionOverlay } from "../overlay";
import { IconButton } from "../icon-button";
import { colors } from "../theme";
import { quickReactions, reactionCategories } from "./catalog";

export default function ReactionPicker({
  selected,
  onSelect,
  onClose,
  children,
}: {
  readonly selected?: string | null;
  readonly onSelect: (emoji: string | null) => Promise<void>;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [columns, setColumns] = useState(7);
  const current = reactionCategories[category] ?? reactionCategories[0];
  const select = async (emoji: string) => {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      await onSelect(selected === emoji ? null : emoji);
      onClose();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  const renderEmoji = (entry: (typeof quickReactions)[number]) => (
    <Pressable
      key={entry.emoji}
      accessibilityRole="button"
      accessibilityLabel={
        selected === entry.emoji
          ? `Remove ${entry.name} reaction`
          : `React with ${entry.name}`
      }
      accessibilityState={{
        selected: selected === entry.emoji,
        disabled: pending,
      }}
      disabled={pending}
      aria-disabled={pending}
      onPress={() => {
        void select(entry.emoji);
      }}
      style={({ pressed }) => [
        styles.emoji,
        selected === entry.emoji && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.glyph}>{entry.emoji}</Text>
    </Pressable>
  );
  return (
    <CompanionOverlay title="Message reactions" onClose={onClose}>
      <View style={styles.backdrop}>
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
          style={styles.panel}
          onLayout={({ nativeEvent }) => {
            setColumns(
              Math.max(1, Math.floor((nativeEvent.layout.width - 24) / 44))
            );
          }}
        >
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {expanded ? current.name : "Message"}
            </Text>
            {pending && (
              <ActivityIndicator accessibilityLabel="Saving reaction" />
            )}
            <IconButton icon={X} label="Close reactions" onPress={onClose} />
          </View>
          {expanded ? (
            <>
              <ScrollView
                horizontal
                style={styles.categories}
                contentContainerStyle={styles.categoryRow}
              >
                {reactionCategories.map((item, index) => (
                  <Pressable
                    key={item.name}
                    accessibilityRole="tab"
                    accessibilityLabel={item.name}
                    aria-selected={category === index}
                    accessibilityState={{ selected: category === index }}
                    onPress={() => {
                      setCategory(index);
                    }}
                    style={[
                      styles.category,
                      category === index && styles.selected,
                    ]}
                  >
                    <Text style={styles.categoryGlyph}>{item.icon}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <FlatList
                key={`${category}:${columns}`}
                data={current.items}
                keyExtractor={(item) => item.emoji}
                numColumns={columns}
                initialNumToRender={42}
                windowSize={3}
                style={styles.grid}
                renderItem={({ item }) => renderEmoji(item)}
                keyboardShouldPersistTaps="handled"
              />
            </>
          ) : (
            <>
              <View style={styles.quick}>
                {quickReactions.map(renderEmoji)}
                <IconButton
                  icon={Plus}
                  label="More reactions"
                  onPress={() => {
                    setExpanded(true);
                  }}
                />
              </View>
              <View style={styles.actions}>{children}</View>
            </>
          )}
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              Couldn’t save your reaction. Try again.
            </Text>
          )}
        </View>
      </View>
    </CompanionOverlay>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(252,252,252,0.45)",
    padding: 8,
  },
  panel: {
    width: 340,
    maxWidth: "100%",
    maxHeight: "90%",
    padding: 12,
    borderRadius: 24,
    backgroundColor: colors.canvas,
    boxShadow: "0 8px 48px rgba(0,0,0,0.14)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 8,
    gap: 8,
  },
  title: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.ink },
  quick: { flexDirection: "row", flexWrap: "wrap", paddingVertical: 8 },
  emoji: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  glyph: { fontSize: 26 },
  selected: { backgroundColor: colors.wash },
  pressed: { opacity: 0.6 },
  categories: { flexGrow: 0, marginVertical: 8 },
  categoryRow: { gap: 2 },
  category: {
    width: 36,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryGlyph: { fontSize: 20 },
  grid: { height: 308, flexGrow: 0, flexShrink: 1 },
  actions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingTop: 8,
    gap: 2,
  },
  error: { fontSize: 14, color: colors.danger, padding: 8 },
});

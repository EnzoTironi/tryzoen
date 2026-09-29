import { useState, type ReactNode } from "react";
import {
  Animated,
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutRectangle,
} from "react-native";
import { ArrowLeft, Plus, X } from "lucide-react-native";
import { useSheetDrag, SheetGrabber } from "../sheet-drag";
import { CompanionOverlay } from "../overlay";
import { IconButton } from "../icon-button";
import { colors } from "../theme";
import { quickReactions, reactionCategories } from "./catalog";

export default function ReactionPicker({
  anchor,
  outgoing,
  selected,
  onSelect,
  onClose,
  children,
}: {
  readonly anchor: LayoutRectangle;
  readonly outgoing: boolean;
  readonly selected?: string | null;
  readonly onSelect?: (emoji: string | null) => Promise<void>;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const compact = width < 720;
  const drag = useSheetDrag(compact, onClose);
  const [panelHeight, setPanelHeight] = useState(0);
  const menuWidth = Math.min(304, width - 24);
  const left = Math.max(
    12,
    Math.min(
      width - menuWidth - 12,
      anchor.x + anchor.width - (outgoing ? menuWidth : 28)
    )
  );
  const top = Math.max(12, Math.min(anchor.y + 30, height - panelHeight - 12));
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [columns, setColumns] = useState(7);
  const current = reactionCategories[category] ?? reactionCategories[0];
  const select = async (emoji: string) => {
    if (pending || !onSelect) return;
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
  const renderEmoji = (
    entry: Pick<
      (typeof reactionCategories)[number]["items"][number],
      "emoji" | "name"
    >
  ) => (
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
    <CompanionOverlay title="Ações da mensagem" onClose={onClose}>
      <View style={[styles.backdrop, compact && styles.mobileBackdrop]}>
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
            styles.panel,
            { transform: [{ translateY: drag.offset }] },
            compact
              ? [styles.mobilePanel, { maxHeight: height * 0.82 }]
              : {
                  width: menuWidth,
                  maxHeight: height - 24,
                  left,
                  top,
                  opacity: panelHeight ? 1 : 0,
                },
          ]}
          onLayout={({ nativeEvent }) => {
            setPanelHeight(nativeEvent.layout.height);
            setColumns(
              Math.max(1, Math.floor((nativeEvent.layout.width - 24) / 44))
            );
          }}
        >
          {compact && <SheetGrabber handlers={drag.handlers} />}
          {expanded && (
            <View style={styles.header}>
              <IconButton
                icon={ArrowLeft}
                label="Voltar às ações"
                onPress={() => {
                  setExpanded(false);
                }}
              />
              <Text accessibilityRole="header" style={styles.title}>
                {current.name}
              </Text>
              <IconButton icon={X} label="Fechar reações" onPress={onClose} />
            </View>
          )}
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
              {onSelect && (
                <View style={styles.quick}>
                  {quickReactions.slice(0, 5).map(renderEmoji)}
                  <IconButton
                    icon={Plus}
                    label="Mais reações"
                    onPress={() => {
                      setExpanded(true);
                    }}
                  />
                </View>
              )}
              <ScrollView
                style={styles.actions}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            </>
          )}
          {pending && (
            <ActivityIndicator
              accessibilityLabel="Salvando reação"
              style={styles.pending}
            />
          )}
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              Não foi possível salvar a reação. Tente novamente.
            </Text>
          )}
        </Animated.View>
      </View>
    </CompanionOverlay>
  );
}
const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  mobileBackdrop: {
    backgroundColor: "rgba(0,0,0,0.16)",
    justifyContent: "flex-end",
  },
  panel: {
    position: "absolute",
    padding: 8,
    borderRadius: 18,
    backgroundColor: colors.canvas,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
  },
  mobilePanel: {
    position: "relative",
    width: "100%",
    padding: 12,
    paddingBottom: 28,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 8,
    gap: 8,
  },
  title: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.ink },
  quick: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 2,
    paddingBottom: 8,
  },
  emoji: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: colors.wash,
  },
  glyph: { fontSize: 26 },
  selected: {
    backgroundColor: "#dceaff",
    borderWidth: 1,
    borderColor: colors.accent,
  },
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
  actions: { flexGrow: 0, flexShrink: 1 },
  pending: { padding: 6 },
  error: { fontSize: 14, color: colors.danger, padding: 8 },
});

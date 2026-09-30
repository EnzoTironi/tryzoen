import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Clock3 } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CompanionPage, usePageStyles } from "./page";
import { ActionButton } from "./button";
import { useColors } from "./theme";

export interface UpcomingItem {
  readonly id: string;
  readonly title: string;
  readonly cadence: string;
  readonly group: string;
  readonly status: "active" | "paused" | "completed";
  readonly nextRun?: string;
  readonly lastRun?: string;
  readonly delivery?: string;
  readonly canManage: boolean;
  readonly conversationId?: string;
}
export function Upcoming({
  items,
  loading,
  error,
  pendingId,
  hasMore,
  onRetry,
  onToggle,
  onConversation,
  onCreate,
  renderHistory,
}: {
  readonly items: readonly UpcomingItem[];
  readonly loading?: boolean;
  readonly error?: string;
  readonly pendingId?: string;
  readonly hasMore?: boolean;
  readonly onRetry: () => void;
  readonly onToggle: (id: string) => void;
  readonly onConversation: (id: string) => void;
  readonly onCreate: () => void;
  readonly renderHistory: (id: string) => ReactNode;
}) {
  const pageStyles = usePageStyles();
  return (
    <CompanionPage
      title="Upcoming"
      loading={loading}
      error={error}
      onRetry={onRetry}
    >
      {[...new Set(items.map((item) => item.group))].map((group) => (
        <View key={group}>
          <Text accessibilityRole="header" style={pageStyles.heading}>
            {group}
          </Text>
          {items
            .filter((item) => item.group === group)
            .map((item) => (
              <UpcomingRow
                key={item.id}
                item={item}
                pending={pendingId !== undefined}
                onToggle={() => {
                  onToggle(item.id);
                }}
                onConversation={onConversation}
                renderHistory={renderHistory}
              />
            ))}
        </View>
      ))}
      {!loading && !error && items.length === 0 && (
        <Text style={pageStyles.copy}>
          Scheduled tasks appear here. Decide what Zoen should check and when.
        </Text>
      )}
      {hasMore && (
        <Text style={pageStyles.copy}>
          Showing the first 50 schedules, with active schedules first. Other
          schedules remain in their original conversations.
        </Text>
      )}
      <View style={pageStyles.section}>
        <ActionButton quiet onPress={onCreate}>
          Schedule a task
        </ActionButton>
      </View>
    </CompanionPage>
  );
}
function UpcomingRow({
  item,
  pending,
  onToggle,
  onConversation,
  renderHistory,
}: {
  readonly item: UpcomingItem;
  readonly pending: boolean;
  readonly onToggle: () => void;
  readonly onConversation: (id: string) => void;
  readonly renderHistory: (id: string) => ReactNode;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <View style={styles.item}>
      <Pressable
        accessibilityRole="button"
        aria-expanded={expanded}
        accessibilityLabel={item.title}
        onPress={() => {
          setExpanded(!expanded);
        }}
        style={pageStyles.row}
      >
        <View style={styles.icon}>
          <Clock3 size={24} strokeWidth={1.7} color={colors.ink} />
        </View>
        <View style={pageStyles.rowCopy}>
          <Text style={pageStyles.rowTitle}>{item.title}</Text>
          <Text style={pageStyles.copy}>{item.cadence}</Text>
          <Text style={pageStyles.copy}>
            {item.status === "paused"
              ? "Paused"
              : item.status === "completed"
                ? "No upcoming runs"
                : (item.nextRun ?? "No next run scheduled")}
          </Text>
        </View>
        <Chevron size={18} color={colors.muted} />
      </Pressable>
      {expanded && (
        <View style={styles.detail}>
          {item.lastRun && (
            <Text style={pageStyles.copy}>Last run: {item.lastRun}</Text>
          )}
          {item.delivery && (
            <Text style={pageStyles.copy}>Delivery: {item.delivery}</Text>
          )}
          <View style={styles.actions}>
            {item.canManage && item.status !== "completed" && (
              <ActionButton quiet disabled={pending} onPress={onToggle}>
                {item.status === "active" ? "Pause" : "Resume"}
              </ActionButton>
            )}
            {item.conversationId && (
              <ActionButton
                quiet
                onPress={() => {
                  if (item.conversationId) onConversation(item.conversationId);
                }}
              >
                Open conversation
              </ActionButton>
            )}
          </View>
          {renderHistory(item.id)}
        </View>
      )}
    </View>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    item: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    icon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: "#f1f1f2",
      justifyContent: "center",
      alignItems: "center",
    },
    detail: { gap: 12, paddingLeft: 60, paddingBottom: 20 },
    actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  });
}

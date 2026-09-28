import { useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Grip } from "lucide-react-native";
import { GoalRow } from "./row";
import { colors } from "../theme";

export function GoalGroup({
  title,
  tracking = false,
  parents,
  items,
  onOpen,
  onToggle,
  onOptions,
  pendingId,
  showSubtitle,
}: {
  readonly title: string;
  readonly tracking?: boolean;
  readonly parents: readonly ComponentProps<typeof GoalRow>["item"][];
  readonly items: readonly ComponentProps<typeof GoalRow>["item"][];
  readonly onOpen: (id: string) => void;
  readonly onToggle: (id: string) => void;
  readonly onOptions: (id: string) => void;
  readonly pendingId?: string;
  readonly showSubtitle: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (parents.length === 0) return null;
  const visible = expanded ? parents : parents.slice(0, 3);
  const remaining = parents.length - visible.length;
  const color = tracking ? "#237a19" : "#1267bf";
  return (
    <View style={styles.group}>
      <View style={styles.header}>
        <View style={[styles.marker, { backgroundColor: `${color}20` }]}>
          <View style={[styles.dot, { backgroundColor: color }]} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color }]}>
          {title}
        </Text>
      </View>
      {visible
        .flatMap((parent) =>
          [parent].concat(items.filter((item) => item.parentId === parent.id))
        )
        .map((item) => (
          <GoalRow
            key={item.id}
            item={item}
            pending={pendingId === item.id}
            showSubtitle={showSubtitle}
            onOpen={() => {
              onOpen(item.id);
            }}
            onToggle={() => {
              onToggle(item.id);
            }}
            onOptions={() => {
              onOptions(item.id);
            }}
          />
        ))}
      {parents.length > 3 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setExpanded(!expanded);
          }}
          style={styles.more}
        >
          <Grip size={17} color={colors.muted} />
          <Text style={styles.moreText}>
            {expanded ? "Show less" : `Show ${remaining} more`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    paddingBottom: 20,
    marginBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  header: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    marginBottom: 8,
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  title: { fontSize: 17, fontWeight: "600" },
  more: { flexDirection: "row", gap: 10, alignItems: "center", minHeight: 44 },
  moreText: { color: colors.muted, fontSize: 14 },
});

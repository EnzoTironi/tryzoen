import { Pencil, PlusSquare, SquareCheck, Trash2 } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CompanionOverlay } from "../overlay";
import { colors } from "../theme";

export function GoalActions({
  completed,
  canAddSubgoal,
  onAction,
  onClose,
}: {
  readonly completed: boolean;
  readonly canAddSubgoal: boolean;
  readonly onAction: (
    action: "complete" | "subgoal" | "rename" | "delete"
  ) => void;
  readonly onClose: () => void;
}) {
  const actions = [
    {
      id: "complete",
      label: completed ? "Reopen" : "Complete",
      icon: SquareCheck,
    },
    ...(canAddSubgoal
      ? [{ id: "subgoal", label: "Add subgoal", icon: PlusSquare } as const]
      : []),
    { id: "rename", label: "Rename", icon: Pencil },
    { id: "delete", label: "Delete", icon: Trash2 },
  ] as const;
  return (
    <CompanionOverlay title="Goal actions" onClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close goal actions"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          {actions.map(({ id, label, icon: Icon }) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              onPress={() => {
                onAction(id);
              }}
              style={[styles.row, id === "delete" && styles.destructive]}
            >
              <Icon
                size={22}
                strokeWidth={1.7}
                color={id === "delete" ? colors.danger : colors.ink}
              />
              <Text style={[styles.label, id === "delete" && styles.danger]}>
                {label}
              </Text>
            </Pressable>
          ))}
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
    padding: 24,
    paddingTop: 12,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.canvas,
  },
  handle: {
    width: 48,
    height: 4,
    backgroundColor: colors.line,
    borderRadius: 3,
    alignSelf: "center",
    marginBottom: 20,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 8,
  },
  label: { color: colors.ink, fontSize: 18 },
  destructive: {
    marginTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: 12,
  },
  danger: { color: colors.danger },
});

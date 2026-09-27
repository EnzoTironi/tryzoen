import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleDollarSign,
  Heart,
  Laptop,
  Palette,
  SquareCheck,
  Users,
} from "lucide-react-native";
import { CompanionPage, pageStyles } from "./page";
import { colors } from "./theme";
const categories = [
  { name: "Health", icon: Heart },
  { name: "Relationships", icon: Users },
  { name: "Finances", icon: CircleDollarSign },
  { name: "Career", icon: BriefcaseBusiness },
  { name: "Interests", icon: Palette },
  { name: "Productivity", icon: Laptop },
  { name: "Something else", icon: SquareCheck },
];
export function Goals({
  items,
  onOpen,
  onToggle,
  onCreate,
  pendingId,
  ...state
}: Omit<ComponentProps<typeof CompanionPage>, "title" | "children"> & {
  readonly items: readonly {
    id: string;
    title: string;
    description: string;
    completed: boolean;
    parentId?: string;
  }[];
  readonly onOpen: (id: string) => void;
  readonly onToggle: (id: string) => void;
  readonly onCreate: (category: string) => void;
  readonly pendingId?: string;
}) {
  return (
    <CompanionPage title="Goals" {...state}>
      {items.length > 0 && (
        <View>
          <Text accessibilityRole="header" style={styles.tracking}>
            ● Tracking
          </Text>
          {items
            .filter((item) => !item.parentId)
            .flatMap((parent) =>
              [parent].concat(
                items.filter((item) => item.parentId === parent.id)
              )
            )
            .map((item) => (
              <GoalRow
                key={item.id}
                item={item}
                pending={pendingId === item.id}
                onOpen={() => {
                  onOpen(item.id);
                }}
                onToggle={() => {
                  onToggle(item.id);
                }}
              />
            ))}
        </View>
      )}
      <View style={pageStyles.section}>
        <Text accessibilityRole="header" style={pageStyles.heading}>
          Create a goal
        </Text>
        {categories.map(({ name, icon: Icon }) => (
          <Pressable
            accessibilityRole="button"
            key={name}
            onPress={() => {
              onCreate(name);
            }}
            style={pageStyles.row}
          >
            <Icon size={23} color={colors.muted} strokeWidth={1.7} />
            <Text style={[pageStyles.rowTitle, { flex: 1 }]}>{name}</Text>
            <ChevronRight size={18} color={colors.muted} />
          </Pressable>
        ))}
      </View>
    </CompanionPage>
  );
}
export function GoalRow({
  item,
  pending,
  onOpen,
  onToggle,
}: {
  readonly item: ComponentProps<typeof Goals>["items"][number];
  readonly pending: boolean;
  readonly onOpen: () => void;
  readonly onToggle: () => void;
}) {
  return (
    <View style={[pageStyles.row, item.parentId && styles.subgoal]}>
      <Pressable
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- React Native provides shared checkbox semantics.
        role="checkbox"
        aria-checked={item.completed}
        aria-disabled={pending}
        hitSlop={12}
        accessibilityLabel={`${item.completed ? "Reopen" : "Complete"} ${item.title}`}
        disabled={pending}
        onPress={onToggle}
        style={[styles.checkbox, item.completed && styles.checked]}
      >
        {item.completed && <Check size={16} color="white" />}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={pageStyles.rowCopy}
      >
        <Text style={[pageStyles.rowTitle, item.completed && styles.completed]}>
          {item.title}
        </Text>
        <Text style={pageStyles.copy}>{item.description}</Text>
      </Pressable>
      <ChevronRight size={16} color={colors.muted} />
    </View>
  );
}
const styles = StyleSheet.create({
  subgoal: { marginLeft: 28 },
  tracking: {
    fontSize: 18,
    fontWeight: "600",
    color: "#237a19",
    marginBottom: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: colors.muted,
    borderRadius: 4,
    alignSelf: "flex-start",
    marginTop: 3,
  },
  checked: { backgroundColor: "#237a19", borderColor: "#237a19" },
  completed: { textDecorationLine: "line-through", color: colors.muted },
});

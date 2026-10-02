import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Check, ChevronRight, Ellipsis } from "lucide-react-native";
import { IconButton } from "../icon-button";
import { usePageStyles } from "../page";
import { useColors } from "../theme";

export function GoalRow({
  item,
  pending,
  onOpen,
  onToggle,
  onOptions,
  showSubtitle = true,
}: {
  readonly item: {
    id: string;
    title: string;
    description: string;
    completed: boolean;
    parentId?: string;
    tracking?: boolean;
  };
  readonly pending: boolean;
  readonly showSubtitle?: boolean;
  readonly onOpen: () => void;
  readonly onToggle: () => void;
  readonly onOptions?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
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
        {showSubtitle && item.description ? (
          <Text style={pageStyles.copy}>{item.description}</Text>
        ) : null}
      </Pressable>
      {onOptions ? (
        <IconButton
          icon={Ellipsis}
          label={`Actions for ${item.title}`}
          disabled={pending}
          onPress={onOptions}
        />
      ) : (
        <ChevronRight size={16} color={colors.muted} />
      )}
    </View>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    subgoal: { marginLeft: 28 },
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
}

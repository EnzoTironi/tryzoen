import { useMemo, useRef, useState, type ComponentProps } from "react";
import { useMutation } from "@tanstack/react-query";
import { Pencil, PlusSquare, SquareCheck, Trash2 } from "lucide-react-native";
import { Pressable, StyleSheet, Text } from "react-native";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import { CompanionSheet, SheetSurface } from "../sheet";
import { systemFont, useColors } from "../theme";
import type { GoalDetail } from "./detail";
import { GoalRename } from "./rename";

export function GoalActions({
  goal,
  data,
  onChanged,
  onPrompt,
  onClose,
}: Pick<
  ComponentProps<typeof GoalDetail>,
  "goal" | "data" | "onChanged" | "onPrompt" | "onClose"
>) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  // Keep the revision and receipt stable while this menu is open, including retries.
  const [target] = useState(goal);
  const [operations] = useState(() => ({
    complete: data.newOperationId(),
    delete: data.newOperationId(),
  }));
  const [view, setView] = useState<"menu" | "rename" | "delete">("menu");
  const renameAttempt = useRef({ title: "", id: "" });
  const change = useMutation({
    mutationFn: (action: "complete" | "delete") =>
      action === "complete"
        ? data.complete(
            target.id,
            target.revision,
            !target.completed,
            operations.complete
          )
        : data.remove(target.id, target.revision, operations.delete),
    onSuccess: async () => {
      await onChanged();
      onClose();
    },
  });
  const close = () => {
    if (!change.isPending) onClose();
  };
  if (view === "rename")
    return (
      <GoalRename
        initialTitle={target.title}
        onClose={onClose}
        onSave={async (title) => {
          if (renameAttempt.current.title !== title)
            renameAttempt.current = { title, id: data.newOperationId() };
          await data.rename(
            target.id,
            target.revision,
            title,
            renameAttempt.current.id
          );
          await onChanged();
        }}
      />
    );
  if (view === "delete")
    return (
      <CompanionSheet title="Delete this goal?" onClose={close}>
        <Text style={pageStyles.rowTitle}>{target.title}</Text>
        <Text style={pageStyles.copy}>
          This removes the saved goal, its subgoals and their activity history.
          Existing conversations and schedules are unchanged.
        </Text>
        {change.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {change.error.message}
          </Text>
        )}
        <ActionButton
          disabled={change.isPending}
          onPress={() => {
            change.mutate("delete");
          }}
        >
          Delete goal and history
        </ActionButton>
        <ActionButton quiet disabled={change.isPending} onPress={close}>
          Keep goal
        </ActionButton>
      </CompanionSheet>
    );
  return (
    <GoalActionMenu
      completed={target.completed}
      canAddSubgoal={!target.parentId}
      pending={change.isPending}
      error={change.error?.message}
      onClose={close}
      onAction={(action) => {
        if (action === "complete") change.mutate(action);
        else if (action === "subgoal") {
          onClose();
          onPrompt(
            `Help me add a subgoal to “${target.title}” (workstream ID ${target.reference}). Read the parent first, ask what milestone I want, and save the agreed subgoal with parentId set to this parent. Do not create a schedule without discussing it.`
          );
        } else setView(action);
      }}
    />
  );
}

function GoalActionMenu({
  completed,
  canAddSubgoal,
  pending,
  error,
  onClose,
  onAction,
}: {
  readonly completed: boolean;
  readonly canAddSubgoal: boolean;
  readonly pending: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onAction: (
    action: "complete" | "subgoal" | "rename" | "delete"
  ) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
    <SheetSurface
      title="Goal actions"
      onClose={onClose}
      panelStyle={styles.sheet}
      maxWidth={420}
    >
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {actions.map(({ id, label, icon: Icon }) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          disabled={pending}
          aria-disabled={pending}
          onPress={() => {
            onAction(id);
          }}
          style={[
            styles.row,
            id === "delete" && styles.destructive,
            pending && styles.pending,
          ]}
        >
          <Icon
            size={18}
            strokeWidth={1.7}
            color={id === "delete" ? colors.danger : colors.ink}
          />
          <Text style={[styles.label, id === "delete" && styles.danger]}>
            {label}
          </Text>
        </Pressable>
      ))}
      <ActionButton quiet disabled={pending} onPress={onClose}>
        Cancel
      </ActionButton>
    </SheetSurface>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    sheet: { paddingHorizontal: 24, paddingBottom: 24 },
    row: {
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 8,
    },
    label: { fontFamily: systemFont, color: colors.ink, fontSize: 16 },
    destructive: {
      marginTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
      paddingTop: 12,
    },
    danger: { color: colors.danger },
    error: {
      fontFamily: systemFont,
      color: colors.danger,
      fontSize: 14,
      marginBottom: 12,
    },
    pending: { opacity: 0.5 },
  });
}

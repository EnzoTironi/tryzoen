import { useRef, useState, type ReactNode, type ComponentProps } from "react";
import type { GoalRow } from "./row";
import { Ellipsis, X } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ActionButton } from "../button";
import { DocumentEditor } from "../document-editor";
import { IconButton } from "../icon-button";
import { CompanionOverlay } from "../overlay";
import { pageStyles } from "../page";
import { colors } from "../theme";
import type { GoalsData } from "./collection";
import { GoalActions } from "./actions";
import { GoalActivity } from "./activity";

export function GoalDetail({
  goal,
  subgoals,
  data,
  cacheScope,
  onChanged,
  onClose,
  onPrompt,
}: {
  readonly goal: ComponentProps<typeof GoalRow>["item"] & {
    revision: number;
    objective: string;
    notes: string;
    reference: string;
  };
  readonly subgoals: readonly ReactNode[] | undefined;
  readonly data: GoalsData;
  readonly cacheScope: string;
  readonly onChanged: () => Promise<void>;
  readonly onClose: () => void;
  readonly onPrompt: (prompt: string) => void;
}) {
  const [rename, setRename] = useState<{
    title: string;
    revision: number;
    operationId: string;
  }>();
  const [deletion, setDeletion] = useState<{
    revision: number;
    operationId: string;
  }>();
  const [menu, setMenu] = useState(false);
  const renameAttempt = useRef({ key: "", id: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const perform = async (action: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await action();
      await onChanged();
      setRename(undefined);
      if (deletion) onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This goal could not be updated. Try again."
      );
    } finally {
      setPending(false);
    }
  };
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <CompanionOverlay title={goal.title} onClose={close}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close goal"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.heading}>
              {goal.title}
            </Text>
            <View style={styles.roundControl}>
              <IconButton
                label="Goal actions"
                icon={Ellipsis}
                disabled={pending}
                onPress={() => {
                  setMenu(true);
                }}
              />
            </View>
            <View style={styles.roundControl}>
              <IconButton label="Close goal details" icon={X} onPress={close} />
            </View>
          </View>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.objective}>{goal.objective}</Text>
            {menu && (
              <GoalActions
                completed={goal.completed}
                canAddSubgoal={!goal.parentId}
                onClose={() => {
                  setMenu(false);
                }}
                onAction={(action) => {
                  setMenu(false);
                  if (action === "complete")
                    void perform(() =>
                      data.complete(
                        goal.id,
                        goal.revision,
                        !goal.completed,
                        data.newOperationId()
                      )
                    );
                  if (action === "rename") {
                    setDeletion(undefined);
                    setRename({
                      title: goal.title,
                      revision: goal.revision,
                      operationId: data.newOperationId(),
                    });
                  }
                  if (action === "delete") {
                    setRename(undefined);
                    setDeletion({
                      revision: goal.revision,
                      operationId: data.newOperationId(),
                    });
                  }
                  if (action === "subgoal") {
                    onClose();
                    onPrompt(
                      `Help me add a subgoal to “${goal.title}” (workstream ID ${goal.reference}). Read the parent first, ask what milestone I want, and save the agreed subgoal with parentId set to this parent. Do not create a schedule without discussing it.`
                    );
                  }
                }}
              />
            )}
            {rename && (
              <DocumentEditor
                title="Rename goal"
                label="Goal name"
                description=""
                initialText={rename.title}
                maxLength={100}
                saveLabel="Save name"
                onSave={async (title) => {
                  if (!title.trim()) throw new Error("Enter a goal name.");
                  const key = JSON.stringify([rename.operationId, title]);
                  if (renameAttempt.current.key !== key)
                    renameAttempt.current = { key, id: data.newOperationId() };
                  await data.rename(
                    goal.id,
                    rename.revision,
                    title,
                    renameAttempt.current.id
                  );
                  await onChanged();
                }}
                onClose={() => {
                  setRename(undefined);
                }}
              />
            )}
            {deletion && (
              <View style={styles.form}>
                <Text style={pageStyles.heading}>Delete this goal?</Text>
                <Text style={pageStyles.copy}>
                  This removes the saved goal, its subgoals and their activity
                  history. Existing conversations and schedules are unchanged.
                </Text>
                <View style={styles.actions}>
                  <ActionButton
                    disabled={pending}
                    onPress={() => {
                      void perform(() =>
                        data.remove(
                          goal.id,
                          deletion.revision,
                          deletion.operationId
                        )
                      );
                    }}
                  >
                    Delete goal and history
                  </ActionButton>
                  <ActionButton
                    quiet
                    disabled={pending}
                    onPress={() => {
                      setDeletion(undefined);
                      setError(undefined);
                    }}
                  >
                    Keep goal
                  </ActionButton>
                </View>
              </View>
            )}
            {error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            {Boolean(subgoals?.length) && (
              <View>
                <Text style={pageStyles.heading}>Subgoals</Text>
                {subgoals}
              </View>
            )}
            <GoalActivity
              data={data}
              id={goal.id}
              revision={goal.revision}
              cacheScope={cacheScope}
            />
          </ScrollView>
        </View>
      </View>
    </CompanionOverlay>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(252,252,252,0.65)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  sheet: {
    width: "100%",
    maxWidth: 740,
    maxHeight: "90%",
    backgroundColor: colors.canvas,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  handle: {
    width: 48,
    height: 4,
    backgroundColor: colors.line,
    borderRadius: 3,
    alignSelf: "center",
    marginTop: 12,
  },
  header: { flexDirection: "row", alignItems: "center", padding: 24, gap: 12 },
  heading: {
    flex: 1,
    color: colors.ink,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "600",
  },
  content: { padding: 24, paddingTop: 0, gap: 20 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  form: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.wash,
    gap: 12,
  },
  objective: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 8,
  },
  roundControl: {
    borderRadius: 22,
    backgroundColor: colors.surface,
    boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
  },
  error: { color: colors.danger, fontSize: 15 },
});

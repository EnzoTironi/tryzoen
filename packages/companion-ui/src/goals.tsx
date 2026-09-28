import { useState, type ComponentProps } from "react";
import { Text } from "react-native";
import { Ellipsis } from "lucide-react-native";
import { CompanionPage, pageStyles } from "./page";
import { IconButton } from "./icon-button";
import { GoalOptions } from "./goals/options";
import { CompanionSheet } from "./sheet";
import { GoalCreation } from "./goals/create";
import { GoalRow } from "./goals/row";
import { GoalGroup } from "./goals/group";

export function Goals({
  items,
  onOpen,
  onToggle,
  onOptions,
  onCreate,
  pendingId,
  preferences,
  preferencePending,
  preferenceError,
  onPreference,
  ...state
}: Omit<ComponentProps<typeof CompanionPage>, "title" | "children"> & {
  readonly items: readonly ComponentProps<typeof GoalRow>["item"][];
  readonly onOpen: (id: string) => void;
  readonly onToggle: (id: string) => void;
  readonly onOptions: (id: string) => void;
  readonly onCreate: (category: string) => void;
  readonly pendingId?: string;
  readonly preferences: ComponentProps<typeof GoalOptions>["preferences"];
  readonly preferencePending: boolean;
  readonly preferenceError?: string;
  readonly onPreference: ComponentProps<typeof GoalOptions>["onChange"];
}) {
  const [view, setView] = useState<"options" | "completed">();
  const sorted = preferences.sortAutomatically
    ? items
    : // oxlint-disable-next-line unicorn/no-array-sort -- The shared native package targets ES2022; sort an owned copy.
      [...items].sort((a, b) => a.title.localeCompare(b.title));
  const completed = sorted.filter((item) => item.completed);
  const active = sorted.filter((item) => !item.completed);
  const rootIds = new Set(active.map((item) => item.parentId));
  const roots = sorted.filter(
    (item) => !item.parentId && (!item.completed || rootIds.has(item.id))
  );
  const rowProps = {
    onOpen,
    onToggle,
    onOptions,
    pendingId,
    showSubtitle: preferences.showSubtitles,
  };
  return (
    <>
      <CompanionPage
        title="Goals"
        {...state}
        actions={
          <IconButton
            label="Goal options"
            icon={Ellipsis}
            onPress={() => {
              setView("options");
            }}
          />
        }
      >
        <GoalGroup
          title="Tracking"
          tracking
          parents={roots.filter((item) => item.tracking)}
          items={active}
          {...rowProps}
        />
        <GoalGroup
          title="Goals"
          parents={roots.filter((item) => !item.tracking)}
          items={active}
          {...rowProps}
        />
        <GoalCreation onCreate={onCreate} />
      </CompanionPage>
      {view === "options" && (
        <GoalOptions
          preferences={preferences}
          pending={preferencePending}
          error={preferenceError}
          onChange={onPreference}
          onClose={() => {
            setView(undefined);
          }}
          onCompleted={() => {
            setView("completed");
          }}
        />
      )}
      {view === "completed" && (
        <CompanionSheet
          title="Completed goals"
          onClose={() => {
            setView(undefined);
          }}
        >
          {completed.length === 0 && (
            <Text style={pageStyles.copy}>No completed goals yet.</Text>
          )}
          {completed.map((item) => (
            <GoalRow
              key={item.id}
              item={item}
              showSubtitle={preferences.showSubtitles}
              pending={pendingId === item.id}
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
        </CompanionSheet>
      )}
    </>
  );
}

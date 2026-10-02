import { useI18n } from "./../i18n";
import { useState, type ComponentProps } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import {
  goalPreferencesSchema,
  type goalPreferenceChangeSchema,
} from "./preferences";
import { Goals } from "../goals";
import { GoalRow } from "./row";
import { GoalDetail } from "./detail";
import { GoalActions } from "./actions";

export interface GoalsData {
  preferences: () => Promise<z.infer<typeof goalPreferencesSchema>>;
  setPreference: (
    change: z.infer<typeof goalPreferenceChangeSchema>
  ) => Promise<z.infer<typeof goalPreferencesSchema>>;
  list: () => Promise<ComponentProps<typeof GoalDetail>["goal"][]>;
  newOperationId: () => string;
  rename: (
    id: string,
    revision: number,
    title: string,
    operationId: string
  ) => Promise<void>;
  remove: (id: string, revision: number, operationId: string) => Promise<void>;
  complete: (
    id: string,
    revision: number,
    completed: boolean,
    operationId: string
  ) => Promise<void>;
  history: (
    id: string,
    beforeRevision?: number
  ) => Promise<{
    items: {
      revision: number;
      date: string;
      title: string;
      summary: string;
      status: string;
    }[];
    nextRevision: number | null;
  }>;
}

export function GoalCollection({
  data,
  cacheScope,
  onPrompt,
}: {
  readonly data: GoalsData;
  readonly cacheScope: string;
  readonly onPrompt: (prompt: string) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string>();
  const [actions, setActions] = useState<string>();
  const queryClient = useQueryClient();
  const preferences = useQuery({
    queryKey: ["goal-preferences", cacheScope],
    queryFn: data.preferences,
  });
  const preference = useMutation({
    mutationFn: data.setPreference,
    onSuccess: (value) => {
      queryClient.setQueryData(["goal-preferences", cacheScope], value);
    },
  });
  const goals = useQuery({
    queryKey: ["companion-goals", cacheScope],
    queryFn: data.list,
  });
  const complete = useMutation({
    mutationFn: (goal: NonNullable<typeof goals.data>[number]) =>
      data.complete(
        goal.id,
        goal.revision,
        !goal.completed,
        data.newOperationId()
      ),
    onSuccess: async () => {
      await goals.refetch();
    },
  });
  const current = goals.data?.find((goal) => goal.id === selected);
  const target = goals.data?.find((goal) => goal.id === actions);
  const refresh = async () => {
    await goals.refetch({ throwOnError: true });
  };
  return (
    <>
      <Goals
        items={goals.data ?? []}
        preferences={preferences.data ?? goalPreferencesSchema.parse({})}
        preferencePending={
          preferences.isPending || preferences.isError || preference.isPending
        }
        preferenceError={
          preferences.error?.message ?? preference.error?.message
        }
        onPreference={(change) => {
          preference.mutate(change);
        }}
        loading={goals.isPending}
        error={
          goals.error?.message ??
          complete.error?.message ??
          preferences.error?.message
        }
        onRetry={() => {
          complete.reset();
          void goals.refetch();
          void preferences.refetch();
        }}
        pendingId={complete.isPending ? complete.variables.id : undefined}
        onOpen={setSelected}
        onOptions={setActions}
        onToggle={(id) => {
          const goal = goals.data?.find((item) => item.id === id);
          if (goal && !complete.isPending) complete.mutate(goal);
        }}
        onCreate={(category) => {
          onPrompt(
            t(
              "Help me create a goal in {value1}. Ask what I want to achieve and save the agreed goal as a workstream. Confirm any schedule separately before enabling it.",
              { value1: category }
            )
          );
        }}
      />
      {current && (
        <GoalDetail
          key={current.id}
          goal={current}
          data={data}
          subgoals={goals.data
            ?.filter((item) => item.parentId === current.id)
            .map((item) => (
              <GoalRow
                key={item.id}
                item={item}
                pending={complete.isPending}
                onOpen={() => {
                  setSelected(item.id);
                }}
                onToggle={() => {
                  if (!complete.isPending) complete.mutate(item);
                }}
                onOptions={() => {
                  setActions(item.id);
                }}
              />
            ))}
          cacheScope={cacheScope}
          onChanged={refresh}
          onClose={() => {
            setSelected(undefined);
          }}
          onPrompt={onPrompt}
        />
      )}
      {target && (
        <GoalActions
          key={target.id}
          goal={target}
          data={data}
          onChanged={refresh}
          onClose={() => {
            setActions(undefined);
          }}
          onPrompt={onPrompt}
        />
      )}
    </>
  );
}

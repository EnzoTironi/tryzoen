import { useState, type ComponentProps } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Goals, GoalRow } from "../goals";
import { GoalDetail } from "./detail";

export interface GoalsData {
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
  const [selected, setSelected] = useState<string>();
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
  return (
    <>
      <Goals
        items={goals.data ?? []}
        loading={goals.isPending}
        error={goals.error?.message ?? complete.error?.message}
        onRetry={() => {
          complete.reset();
          void goals.refetch();
        }}
        pendingId={complete.isPending ? complete.variables.id : undefined}
        onOpen={setSelected}
        onToggle={(id) => {
          const goal = goals.data?.find((item) => item.id === id);
          if (goal && !complete.isPending) complete.mutate(goal);
        }}
        onCreate={(category) => {
          onPrompt(
            `Help me create a goal in ${category}. Ask what I want to achieve and save the agreed goal as a workstream. Confirm any schedule separately before enabling it.`
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
              />
            ))}
          cacheScope={cacheScope}
          onChanged={async () => {
            await goals.refetch();
          }}
          onClose={() => {
            setSelected(undefined);
          }}
          onPrompt={onPrompt}
        />
      )}
    </>
  );
}

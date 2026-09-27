import { z } from "zod";
import type { GoalsData } from "@zoen/companion-ui";
import { companionGoalsSchema, companionGoalHistorySchema } from "./schema";

export function companionGoalsData(
  rpc: {
    query: (path: string, input?: unknown) => Promise<unknown>;
    mutation: (path: string, input?: unknown) => Promise<unknown>;
  },
  newOperationId: () => string
): GoalsData {
  return {
    newOperationId,
    async list() {
      const goals = companionGoalsSchema.parse(
        await rpc.query("companion.goals")
      );
      return goals.flatMap((goal) =>
        goal.content
          ? [
              {
                id: JSON.stringify([goal.scopeKey, goal.id]),
                revision: goal.revision,
                reference: goal.id,
                parentId: goal.content.parentId
                  ? JSON.stringify([goal.scopeKey, goal.content.parentId])
                  : undefined,
                title: goal.content.title,
                description: goal.content.nextStep,
                objective: goal.content.objective,
                notes: goal.content.notes,
                completed: goal.content.status === "completed",
              },
            ]
          : []
      );
    },
    async rename(key, expectedRevision, title, operationId) {
      await rpc.mutation("companion.renameGoal", {
        ...goalIdentity(key),
        expectedRevision,
        title,
        operationId,
      });
    },
    async remove(key, expectedRevision, operationId) {
      await rpc.mutation("companion.deleteGoal", {
        ...goalIdentity(key),
        expectedRevision,
        operationId,
      });
    },
    async complete(key, expectedRevision, completed, operationId) {
      await rpc.mutation("companion.setGoalCompleted", {
        ...goalIdentity(key),
        expectedRevision,
        completed,
        operationId,
      });
    },
    async history(key, beforeRevision) {
      const page = companionGoalHistorySchema.parse(
        await rpc.query("companion.goalHistory", {
          ...goalIdentity(key),
          beforeRevision,
        })
      );
      return {
        items: page.items.map((entry) => ({
          revision: entry.revision,
          date: entry.createdAt,
          title:
            entry.content.progress?.title ??
            `${entry.revision === 1 ? "Added" : "Updated"} ${entry.content.title}`,
          summary:
            entry.content.progress?.description ??
            (entry.content.notes ||
              entry.content.nextStep ||
              entry.content.objective),
          status: entry.content.status,
        })),
        nextRevision: page.nextRevision,
      };
    },
  };
}

function goalIdentity(key: string) {
  const [scopeKey, id] = z
    .tuple([z.string().min(1), z.string().min(1)])
    .parse(JSON.parse(key));
  return { scopeKey, id };
}

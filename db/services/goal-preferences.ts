import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { db, goalPreferences } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  goalPreferencesSchema,
  goalPreferenceChangeSchema,
} from "@zoen/companion-ui/goals";

export async function readGoalPreferences(scope: AccessScope) {
  const [row] = await db
    .select()
    .from(goalPreferences)
    .where(
      and(
        eq(goalPreferences.workspaceId, scope.workspaceId),
        eq(goalPreferences.userId, scope.userId)
      )
    )
    .limit(1);
  return goalPreferencesSchema.parse(row ?? {});
}

export async function saveGoalPreference(
  scope: AccessScope,
  change: z.infer<typeof goalPreferenceChangeSchema>
) {
  const { key, value } = goalPreferenceChangeSchema.parse(change);
  // Update only the selected option: another device may change the other one.
  const [row] = await db
    .insert(goalPreferences)
    .values({
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      [key]: value,
    })
    .onConflictDoUpdate({
      target: [goalPreferences.workspaceId, goalPreferences.userId],
      set: { [key]: value },
    })
    .returning();
  return goalPreferencesSchema.parse(row);
}

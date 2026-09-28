import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, transaction, SqlError } from "@db/queries";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { WorkspaceAccessDenied } from "../workspaces/access";
import {
  DirectoryError,
  UsernameSchema,
  validateUsername,
} from "../accounts/directory";
import { requireCreator } from "./drafts";

export const creatorUsernameSchema = z.strictObject({
  id: z.uuid(),
  username: UsernameSchema,
  expectedUsername: UsernameSchema.nullable(),
});

/** People and bots claim names through the same database uniqueness constraint. */
export async function claimCreatorUsername(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorUsernameSchema>
) {
  const input = creatorUsernameSchema.parse(raw);
  validateUsername(input.username);
  try {
    return await transaction(async () => {
      await requireCreator(actor);
      const [draft] = await query(sql`SELECT id FROM creator_drafts
        WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId}
        AND user_id = ${actor.userId} AND archived_at IS NULL FOR UPDATE`);
      if (!draft) throw new WorkspaceAccessDenied();
      const [current] = await query<{ username: string }>(
        sql`SELECT username FROM user_directory WHERE creator_draft_id = ${input.id}`
      );
      if (current?.username === input.username)
        return { username: input.username, kind: "bot" as const };
      if ((current?.username ?? null) !== input.expectedUsername)
        throw new Error(
          "This username changed elsewhere. Read the bot again before renaming it."
        );
      await query(sql`INSERT INTO user_directory (creator_draft_id, username)
        VALUES (${input.id}, ${input.username}) ON CONFLICT (creator_draft_id)
        DO UPDATE SET username = EXCLUDED.username`);
      return { username: input.username, kind: "bot" as const };
    });
  } catch (error) {
    if (error instanceof SqlError)
      throw new DirectoryError({ reason: "unavailable" });
    throw error;
  }
}

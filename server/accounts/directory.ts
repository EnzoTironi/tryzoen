import {
  query as dbQuery,
  transaction as withDatabaseTransaction,
} from "@db/queries";
import { sql } from "drizzle-orm";
import { SqlError } from "../../db/queries";
import { z } from "zod";

import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
} from "../workspaces/access";

export const UsernameSchema = z.string().regex(/^[a-z][a-z0-9_]{2,29}$/);
export const DirectoryProfileSchema = z.object({
  username: UsernameSchema,
  discoverable: z.boolean(),
});
const reserved = new Set([
  "admin",
  "administrator",
  "support",
  "security",
  "zoen",
  "system",
  "everyone",
  "executor",
  "api",
  "root",
]);
class DirectoryError extends Error {
  readonly _tag = "DirectoryError";
  declare readonly reason: "unavailable" | "reserved" | "invalid";
  constructor(input: {
    readonly reason: "unavailable" | "reserved" | "invalid";
  }) {
    super("DirectoryError");
    this.name = "DirectoryError";
    Object.assign(this, input);
  }
}

export const readDirectoryProfile = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  await requireWorkspaceAccess(actor);

  const rows = await dbQuery(
    sql`SELECT username, discoverable FROM user_directory WHERE ('better-auth:' || user_id) = ${actor.userId}`
  );
  return rows[0] ? await DirectoryProfileSchema.parseAsync(rows[0]) : null;
};

export const saveDirectoryProfile = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof DirectoryProfileSchema>
) {
  const profile = await DirectoryProfileSchema.parseAsync(raw);
  if (reserved.has(profile.username))
    throw new DirectoryError({ reason: "reserved" });

  try {
    return await withDatabaseTransaction(async () => {
      await requireWorkspaceAccess(actor);
      if (!actor.authSessionId) throw new DirectoryError({ reason: "invalid" });
      const rows =
        await dbQuery(sql`INSERT INTO user_directory (user_id, username, discoverable)
      SELECT id, ${profile.username}, ${profile.discoverable} FROM public.user WHERE ('better-auth:' || id) = ${actor.userId}
      ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, discoverable = EXCLUDED.discoverable RETURNING username, discoverable`);
      return await DirectoryProfileSchema.parseAsync(rows[0]);
    });
  } catch (error) {
    if (error instanceof SqlError) {
      throw new DirectoryError({ reason: "unavailable" });
    }
    throw error;
  }
};

export const searchDirectory = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  query: string
) {
  await requireWorkspaceAccess(actor);
  const prefix = query.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,29}$/.test(prefix)) return [];

  const rows = await dbQuery(
    sql`SELECT username FROM user_directory WHERE discoverable = true AND starts_with(username, ${prefix}) ORDER BY username LIMIT 12`
  );
  return await z.array(z.object({ username: UsernameSchema })).parseAsync(rows);
};

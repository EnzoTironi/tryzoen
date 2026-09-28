import { and, desc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { db, personalFeedPosts, personalFeedInstructions } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  feedPostInputSchema,
  feedPostSchema,
  type feedCursorSchema,
  feedInstructionsSchema,
} from "@zoen/companion-ui/feed";

function ownedPost(scope: AccessScope, id?: string) {
  return and(
    eq(personalFeedPosts.workspaceId, scope.workspaceId),
    eq(personalFeedPosts.userId, scope.userId),
    id ? eq(personalFeedPosts.id, id) : undefined
  );
}

function postView(row: typeof personalFeedPosts.$inferSelect) {
  if (!row.content) return undefined;
  const { title, content, rationale, sources } = row.content;
  return feedPostSchema.parse({
    title,
    content,
    rationale,
    sources,
    id: row.id,
    liked: row.liked,
    createdAt: row.createdAt.toISOString(),
  });
}

export async function listFeedPosts(
  scope: AccessScope,
  cursor?: z.infer<typeof feedCursorSchema> | null
) {
  const rows = await db
    .select()
    .from(personalFeedPosts)
    .where(
      and(
        ownedPost(scope),
        isNotNull(personalFeedPosts.content),
        cursor
          ? or(
              lt(personalFeedPosts.createdAt, new Date(cursor.createdAt)),
              and(
                eq(personalFeedPosts.createdAt, new Date(cursor.createdAt)),
                lt(personalFeedPosts.id, cursor.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(personalFeedPosts.createdAt), desc(personalFeedPosts.id))
    .limit(21);
  const items = rows.slice(0, 20).flatMap((row) => {
    const item = postView(row);
    return item ? [item] : [];
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > 20 && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

export async function readFeedPost(scope: AccessScope, id: string) {
  const [row] = await db
    .select()
    .from(personalFeedPosts)
    .where(ownedPost(scope, id))
    .limit(1);
  const post = row ? postView(row) : undefined;
  if (!post) throw new Error("Feed post not found.");
  return post;
}

export async function publishFeedPost(
  scope: AccessScope,
  input: z.infer<typeof feedPostInputSchema>
) {
  const content = feedPostInputSchema.parse(input);
  await db
    .insert(personalFeedPosts)
    .values({ ...scope, key: content.key, content })
    .onConflictDoNothing({
      target: [
        personalFeedPosts.workspaceId,
        personalFeedPosts.userId,
        personalFeedPosts.key,
      ],
    });
  const [row] = await db
    .select({ id: personalFeedPosts.id, content: personalFeedPosts.content })
    .from(personalFeedPosts)
    .where(and(ownedPost(scope), eq(personalFeedPosts.key, content.key)))
    .limit(1);
  if (!row) throw new Error("The post could not be saved.");
  return { id: row.id, deleted: row.content === null };
}

export async function likeFeedPost(
  scope: AccessScope,
  id: string,
  liked: boolean
) {
  const [row] = await db
    .update(personalFeedPosts)
    .set({ liked })
    .where(and(ownedPost(scope, id), isNotNull(personalFeedPosts.content)))
    .returning({ id: personalFeedPosts.id });
  if (!row) throw new Error("Feed post not found.");
  return row;
}

export async function deleteFeedPost(scope: AccessScope, id: string) {
  // Retain only the receipt key: replaying publication cannot resurrect content.
  await db
    .update(personalFeedPosts)
    .set({ content: null, liked: false })
    .where(ownedPost(scope, id));
  return { deleted: true };
}

export async function readFeedInstructions(scope: AccessScope) {
  const [row] = await db
    .select()
    .from(personalFeedInstructions)
    .where(
      and(
        eq(personalFeedInstructions.workspaceId, scope.workspaceId),
        eq(personalFeedInstructions.userId, scope.userId)
      )
    )
    .limit(1);
  return feedInstructionsSchema.parse(row ?? { content: "", revision: 0 });
}

export async function saveFeedInstructions(
  scope: AccessScope,
  input: z.infer<typeof feedInstructionsSchema>
) {
  const change = feedInstructionsSchema.parse(input);
  const rows =
    change.revision === 0
      ? await db
          .insert(personalFeedInstructions)
          .values({
            workspaceId: scope.workspaceId,
            userId: scope.userId,
            content: change.content,
            revision: 1,
          })
          .onConflictDoNothing()
          .returning()
      : await db
          .update(personalFeedInstructions)
          .set({
            content: change.content,
            revision: sql`${personalFeedInstructions.revision} + 1`,
          })
          .where(
            and(
              eq(personalFeedInstructions.workspaceId, scope.workspaceId),
              eq(personalFeedInstructions.userId, scope.userId),
              eq(personalFeedInstructions.revision, change.revision)
            )
          )
          .returning();
  const row = rows[0];
  if (row) return feedInstructionsSchema.parse(row);
  const current = await readFeedInstructions(scope);
  if (current.revision > 0 && current.content === change.content)
    return current;
  throw new Error(
    "Your Feed instructions changed on another device. Your draft is kept; reopen the editor to review the latest version."
  );
}

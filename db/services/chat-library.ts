import { and, desc, eq, exists, ilike, lt, or } from "drizzle-orm";
import type { z } from "zod";
import { agentSessions, chats, db } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { chatChangeSchema, chatQuerySchema } from "@zoen/companion-ui/chats";

function ownedChat(scope: AccessScope) {
  return and(
    eq(chats.workspaceId, scope.workspaceId),
    exists(
      db
        .select({ sessionId: agentSessions.sessionId })
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.sessionId, chats.sessionId),
            eq(agentSessions.workspaceId, scope.workspaceId),
            eq(agentSessions.createdByUserId, scope.userId)
          )
        )
    )
  );
}

export async function listChatLibrary(
  scope: AccessScope,
  input: z.input<typeof chatQuerySchema>
) {
  const { query, cursor, archived } = chatQuerySchema.parse(input);
  const pattern = `%${query.replace(/[\\%_]/gu, "\\$&")}%`;
  const rows = await db
    .select({
      sessionId: chats.sessionId,
      title: chats.title,
      updatedAt: chats.updatedAt,
      pinned: chats.pinned,
      archived: chats.archived,
    })
    .from(chats)
    .where(
      and(
        ownedChat(scope),
        eq(chats.archived, archived),
        query ? ilike(chats.title, pattern) : undefined,
        cursor
          ? or(
              lt(chats.pinned, cursor.pinned),
              and(
                eq(chats.pinned, cursor.pinned),
                or(
                  lt(chats.updatedAt, new Date(cursor.updatedAt)),
                  and(
                    eq(chats.updatedAt, new Date(cursor.updatedAt)),
                    lt(chats.sessionId, cursor.sessionId)
                  )
                )
              )
            )
          : undefined
      )
    )
    .orderBy(desc(chats.pinned), desc(chats.updatedAt), desc(chats.sessionId))
    .limit(31);
  const items = rows.slice(0, 30).map((row) => ({
    sessionId: row.sessionId,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    pinned: row.pinned,
    archived: row.archived,
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > 30 && last
        ? {
            pinned: last.pinned,
            updatedAt: last.updatedAt,
            sessionId: last.sessionId,
          }
        : null,
  };
}

export async function changeChat(
  scope: AccessScope,
  input: z.infer<typeof chatChangeSchema>
) {
  const { sessionId, change } = chatChangeSchema.parse(input);
  const [row] = await db
    .update(chats)
    .set(change)
    .where(and(ownedChat(scope), eq(chats.sessionId, sessionId)))
    .returning({ sessionId: chats.sessionId });
  if (!row) throw new Error("Conversation not found.");
  return row;
}

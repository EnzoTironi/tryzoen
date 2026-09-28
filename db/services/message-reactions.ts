import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { agentSessions, db, messageReactions } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  reactionReadSchema,
  reactionWriteSchema,
} from "@zoen/companion-ui/reactions";

function ownedSession(scope: AccessScope, sessionId: string) {
  return and(
    eq(agentSessions.sessionId, sessionId),
    eq(agentSessions.workspaceId, scope.workspaceId),
    eq(agentSessions.createdByUserId, scope.userId)
  );
}

export async function readMessageReactions(
  scope: AccessScope,
  input: z.infer<typeof reactionReadSchema>
) {
  const { sessionId, messageIds } = reactionReadSchema.parse(input);
  return db
    .select({
      messageId: messageReactions.messageId,
      emoji: messageReactions.emoji,
    })
    .from(messageReactions)
    .innerJoin(
      agentSessions,
      eq(agentSessions.sessionId, messageReactions.sessionId)
    )
    .where(
      and(
        ownedSession(scope, sessionId),
        inArray(messageReactions.messageId, messageIds)
      )
    )
    .limit(50);
}

export async function setMessageReaction(
  scope: AccessScope,
  input: z.infer<typeof reactionWriteSchema>
) {
  const change = reactionWriteSchema.parse(input);
  return db.transaction(async (transaction) => {
    // A concurrent membership/session deletion must finish before or after this write.
    const [session] = await transaction
      .select({ id: agentSessions.sessionId })
      .from(agentSessions)
      .where(ownedSession(scope, change.sessionId))
      .limit(1)
      .for("key share");
    if (!session) throw new Error("Conversation not found.");
    if (change.emoji === null) {
      await transaction
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.sessionId, session.id),
            eq(messageReactions.messageId, change.messageId)
          )
        );
    } else {
      await transaction
        .insert(messageReactions)
        .values({ ...change, emoji: change.emoji })
        .onConflictDoUpdate({
          target: [messageReactions.sessionId, messageReactions.messageId],
          set: { emoji: change.emoji },
        });
    }
    return { messageId: change.messageId, emoji: change.emoji };
  });
}

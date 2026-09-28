import { and, desc, eq, isNull, lt, ne, or } from "drizzle-orm";
import type { z } from "zod";
import { db, personalIdeas, workspaceMemberships } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  ideaProposalSchema,
  type ideaCursorSchema,
  type ideaFeedbackInputSchema,
  type ideaStatusSchema,
} from "@zoen/companion-ui/ideas";

function personalScope(scope: AccessScope) {
  return and(
    eq(personalIdeas.workspaceId, scope.workspaceId),
    eq(personalIdeas.userId, scope.userId)
  );
}

export async function listPersonalIdeas(
  scope: AccessScope,
  cursor?: z.infer<typeof ideaCursorSchema> | null,
  includeDismissed = false
) {
  const rows = await db
    .select()
    .from(personalIdeas)
    .where(
      and(
        personalScope(scope),
        includeDismissed
          ? undefined
          : or(
              isNull(personalIdeas.feedback),
              ne(personalIdeas.feedback, "dismissed")
            ),
        cursor
          ? or(
              lt(personalIdeas.createdAt, new Date(cursor.createdAt)),
              and(
                eq(personalIdeas.createdAt, new Date(cursor.createdAt)),
                lt(personalIdeas.id, cursor.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(personalIdeas.createdAt), desc(personalIdeas.id))
    .limit(31);
  // oxlint-disable-next-line oxc/no-map-spread -- Project immutable proposal data without exposing internal authorization fields.
  const items = rows.slice(0, 30).map((row) => ({
    ...row.proposal,
    id: row.id,
    status: row.status,
    feedback: row.feedback,
    sessionId: row.sessionId,
    createdAt: row.createdAt.toISOString(),
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > 30 && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

export async function proposePersonalIdea(
  scope: AccessScope,
  input: z.infer<typeof ideaProposalSchema>
) {
  const proposal = ideaProposalSchema.parse(input);
  // The first proposal for a topic is immutable. Replays cannot revive dismissed
  // suggestions or change the task the user has already approved.
  await db
    .insert(personalIdeas)
    .values({ ...scope, key: proposal.key, proposal })
    .onConflictDoNothing({
      target: [
        personalIdeas.workspaceId,
        personalIdeas.userId,
        personalIdeas.key,
      ],
    });
  const [row] = await db
    .select({
      id: personalIdeas.id,
      feedback: personalIdeas.feedback,
      status: personalIdeas.status,
    })
    .from(personalIdeas)
    .where(and(personalScope(scope), eq(personalIdeas.key, proposal.key)))
    .limit(1);
  if (!row) throw new Error("The idea could not be saved.");
  return row;
}

export async function ratePersonalIdea(
  scope: AccessScope,
  input: z.infer<typeof ideaFeedbackInputSchema>
) {
  const [row] = await db
    .update(personalIdeas)
    .set({ feedback: input.feedback })
    .where(and(personalScope(scope), eq(personalIdeas.id, input.id)))
    .returning({ id: personalIdeas.id });
  if (!row) throw new Error("Idea not found.");
  return row;
}

/** Freeze the authorization and proposal before any transport handoff. */
export async function acceptPersonalIdea(
  scope: AccessScope,
  id: string,
  authSessionId: string
) {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, scope.workspaceId),
          eq(workspaceMemberships.userId, scope.userId)
        )
      )
      .for("share")
      .limit(1);
    if (!member) throw new Error("Workspace membership is no longer active.");
    const [row] = await tx
      .select()
      .from(personalIdeas)
      .where(and(personalScope(scope), eq(personalIdeas.id, id)))
      .for("update")
      .limit(1);
    if (!row) throw new Error("Idea not found.");
    if (row.status !== "suggested") return row;
    if (row.feedback === "dismissed")
      throw new Error("This idea was dismissed.");
    const [accepted] = await tx
      .update(personalIdeas)
      .set({
        status: "starting",
        startAuthSessionId: authSessionId,
        statusAt: new Date(),
      })
      .where(eq(personalIdeas.id, row.id))
      .returning();
    if (!accepted) throw new Error("The idea could not be started.");
    return accepted;
  });
}

/** Runtime events, rather than optimistic clicks, own execution state. */
export async function recordIdeaExecution(
  scope: AccessScope,
  id: string,
  sessionId: string,
  status: z.infer<typeof ideaStatusSchema>,
  at: Date,
  eventId: string
) {
  await db
    .update(personalIdeas)
    .set({ sessionId, status, statusAt: at, statusEventId: eventId })
    .where(
      and(
        personalScope(scope),
        eq(personalIdeas.id, id),
        ne(personalIdeas.status, "suggested"),
        or(
          isNull(personalIdeas.sessionId),
          eq(personalIdeas.sessionId, sessionId)
        ),
        or(
          lt(personalIdeas.statusAt, at),
          and(
            eq(personalIdeas.statusAt, at),
            or(
              isNull(personalIdeas.statusEventId),
              lt(personalIdeas.statusEventId, eventId)
            )
          )
        )
      )
    );
}

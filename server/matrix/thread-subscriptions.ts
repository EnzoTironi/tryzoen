import { z } from "zod";
import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import {
  threadSubscriptionReadSchema,
  threadSubscriptionWriteSchema,
  type threadSubscriptionSchema,
} from "@zoen/companion-ui/rooms";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { MatrixError, matrixRequest } from "./client";
import { requireJoinedMatrixRoom } from "./rooms";
import { readRoomMessage } from "./messages";
import { TimeoutError, withTimeout } from "../operations/async";
import { lockMatrixAdmission } from "./authority";

const version = "unstable/io.element.msc4306";
const subscription = z.object({ automatic: z.boolean() });
const capabilities = z.object({
  unstable_features: z
    .object({ "org.matrix.msc4306": z.boolean().optional() })
    .optional(),
});

async function subscriptionTarget(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof threadSubscriptionReadSchema>
) {
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
  const room = await requireJoinedMatrixRoom(actor, input.id);
  const root = await readRoomMessage(room, input.rootId, true);
  if (root.content["m.relates_to"]?.rel_type === "m.thread")
    throw new WorkspaceAccessDenied();
  const supported =
    capabilities.parse(
      await matrixRequest("GET", "versions", undefined, undefined, {
        version: "",
        maxResponseBytes: 16_384,
      })
    ).unstable_features?.["org.matrix.msc4306"] === true;
  await requireJoinedMatrixRoom(actor, input.id);
  return {
    room,
    matrixId: room.matrixId,
    supported,
    path: `rooms/${encodeURIComponent(room.roomId)}/thread/${encodeURIComponent(input.rootId)}/subscription`,
  };
}

async function readSubscription(
  target: Awaited<ReturnType<typeof subscriptionTarget>>
): Promise<z.infer<typeof threadSubscriptionSchema>> {
  if (!target.supported) return { status: "unsupported" };
  try {
    const result = subscription.parse(
      await matrixRequest("GET", target.path, undefined, target.matrixId, {
        version,
        maxResponseBytes: 4096,
      })
    );
    return { status: "ready", following: true, automatic: result.automatic };
  } catch (error) {
    if (error instanceof MatrixError && error.reason === "not-found")
      return { status: "ready", following: false, automatic: false };
    throw error;
  }
}

/** Native per-person subscriptions; no local list or replacement push rule. */
export async function readThreadSubscription(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof threadSubscriptionReadSchema>
) {
  const input = threadSubscriptionReadSchema.parse(raw);
  const target = await subscriptionTarget(actor, input);
  const result = await readSubscription(target);
  await requireJoinedMatrixRoom(actor, input.id);
  return result;
}

export async function setThreadSubscription(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof threadSubscriptionWriteSchema>,
  causeEventId?: string
) {
  const input = threadSubscriptionWriteSchema.parse(raw);
  const write = () =>
    transaction(async () => {
      await lockMatrixAdmission([actor.workspaceId], [input.id]);
      await query(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`matrix-thread-subscription:${actor.userId}:${input.id}:${input.rootId}`}, 0))`
      );
      const target = await subscriptionTarget(actor, input);
      if (!target.supported) return { status: "unsupported" as const };
      if (causeEventId) {
        const cause = await readRoomMessage(target.room, causeEventId, true);
        const relation = cause.content["m.relates_to"];
        if (
          !input.following ||
          cause.sender !== target.matrixId ||
          relation?.rel_type !== "m.thread" ||
          relation.event_id !== input.rootId
        )
          throw new WorkspaceAccessDenied();
      }
      try {
        await matrixRequest(
          input.following ? "PUT" : "DELETE",
          target.path,
          input.following
            ? causeEventId
              ? { automatic: causeEventId }
              : {}
            : undefined,
          target.matrixId,
          {
            version,
            maxResponseBytes: 4096,
          }
        );
      } catch (error) {
        // Native event ordering keeps a delayed reply retry from undoing an unfollow.
        if (
          !causeEventId ||
          !(error instanceof MatrixError) ||
          error.reason !== "obsolete-subscription"
        )
          throw error;
      }
      const result = await readSubscription(target);
      await requireJoinedMatrixRoom(actor, input.id);
      return result;
    });
  try {
    // Bound this secondary operation so it cannot hold the message outbox indefinitely.
    return await (causeEventId ? withTimeout(write, 3000) : write());
  } catch (error) {
    // Sending succeeded already; an uncertain alert setting must not ask for a resend.
    if (
      causeEventId &&
      (error instanceof TimeoutError ||
        (error instanceof MatrixError && error.reason === "unavailable"))
    )
      return { status: "unconfirmed" as const };
    throw error;
  }
}

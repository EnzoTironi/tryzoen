import { matrixReplyRelation } from "./replies";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { ChannelReceiveContext, Session } from "eve/channels";
import { parseInputResponses, type InputRequest } from "eve/client";
import { query, transaction } from "@db/queries";
import {
  readChannelInputs,
  renderChannelInput,
} from "../../agent/lib/channel-input";
import { channelConsentRevision } from "../../agent/lib/channel-consent";
import type { DeliveryState } from "../../agent/lib/durable-delivery";
import { operationSignal, withTimeout } from "../operations/async";
import {
  matrixDeliveryActor,
  matrixPrincipal,
  matrixSessionActor,
  requireMatrixEgress,
} from "./authority";
import { matrixConfiguration, matrixRequest, MatrixError } from "./client";
import { publishMatrixInputNotice } from "./delivery";
import { WorkspaceAccessDenied } from "../workspaces/access";

/** Native Eve owns pending inputs. Matrix carries a delivered reference to them. */
const deliveredInput = z.object({
  eventId: z.string(),
  requestId: z.string(),
  revision: z.string(),
});
const promptEvent = z.object({
  sender: z.string(),
  content: z.object({ "dev.zoen.input": deliveredInput.optional() }),
});

export async function publishMatrixInputs(
  eventId: string,
  sessionId: string,
  requests: readonly InputRequest[]
) {
  return transaction(async () => {
    await matrixSessionActor(eventId, sessionId);
    const rows = await query<{
      roomId: string;
    }>(sql`SELECT b.conversation_id AS "roomId" FROM matrix_deliveries d
    JOIN workspace_group_bindings b ON b.id = d.binding_id WHERE d.event_id = ${eventId}`);
    const room = rows[0];
    if (!room) return;
    const bound =
      await query(sql`UPDATE matrix_deliveries SET session_id = ${sessionId}, state = 'dispatched', updated_at = now()
    WHERE event_id = ${eventId} AND state IN ('pending', 'dispatched') AND session_id = ${sessionId} RETURNING event_id`);
    if (bound.length !== 1)
      throw new Error("Matrix input session does not match its delivery");
    for (const request of requests) {
      const reference = {
        eventId,
        requestId: request.requestId,
        revision: channelConsentRevision(request),
      };
      const key = createHash("sha256")
        .update(`${sessionId}:${request.requestId}`)
        .digest("hex");
      const instructions =
        request.kind === "tool-approval"
          ? "\n\nSomente quem pediu pode decidir. Responda “@Zoen aprovar” ou “@Zoen cancelar”."
          : "\n\nQuem fez o pedido pode responder mencionando @Zoen e a opção escolhida.";
      const relation = await matrixReplyRelation(room.roomId, eventId);
      await requireMatrixEgress(eventId, sessionId);
      await matrixRequest(
        "PUT",
        `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/zoen_input_${key}`,
        {
          msgtype: "m.text",
          body: renderChannelInput(request) + instructions,
          "m.relates_to": relation,
          "dev.zoen.input": reference,
        }
      );
    }
  });
}

/** A named, exact decision can only answer one previously delivered request by its original sender. */
export async function respondToMatrixInput(
  eventId: string,
  channel: ChannelReceiveContext<DeliveryState>
) {
  const { actor, source, candidates } = await transaction(
    async () => {
      const requester = await matrixDeliveryActor(eventId);
      const rows = await query<{
        message: string;
        roomId: string;
      }>(sql`SELECT d.message, b.conversation_id AS "roomId"
    FROM matrix_deliveries d JOIN workspace_group_bindings b ON b.id = d.binding_id WHERE d.event_id = ${eventId}`);
      const delivery = rows[0];
      const previousDeliveries = await query<{
        eventId: string;
        sessionId: string;
      }>(sql`SELECT d.event_id AS "eventId", d.session_id AS "sessionId"
    FROM matrix_deliveries d JOIN matrix_deliveries current ON current.event_id = ${eventId}
    WHERE d.binding_id = current.binding_id AND d.epoch = current.epoch AND d.user_id = current.user_id
      AND d.state = 'dispatched' AND d.session_id IS NOT NULL AND d.created_at < current.created_at
    ORDER BY d.created_at DESC LIMIT 25`);
      return {
        actor: requester,
        source: delivery,
        candidates: previousDeliveries,
      };
    },
    { outermost: true }
  );
  if (!source) return { handled: false as const };
  const text = source.message.replace(/^\s*@?zoen\b[\s,:]*/iu, "").trim();
  const optionId = /^(approve|aprovar|aprobar)[.!]?$/iu.test(text)
    ? "approve"
    : /^(cancel|cancelar)[.!]?$/iu.test(text)
      ? "cancel"
      : null;
  const pending = [];
  for (const candidate of candidates) {
    const session = await channel.resolveSession(
      `session:${candidate.sessionId}`
    );
    if (!session || session.id !== candidate.sessionId) continue;
    const requests = await withTimeout(
      () => readChannelInputs(session, operationSignal()),
      15_000
    );
    for (const request of requests)
      pending.push({ candidate, session, request });
  }
  const match =
    pending.length === 1 && candidates.length < 25 ? pending[0] : undefined;
  if (!optionId && match?.request.kind !== "question")
    return { handled: false as const };
  const request = match?.request;
  const selected =
    request?.kind === "tool-approval"
      ? optionId
      : request?.options?.find(
          (option) =>
            option.id.toLowerCase() === text.toLowerCase() ||
            option.label.toLowerCase() === text.toLowerCase()
        )?.id;
  const freeform =
    request?.kind === "question" &&
    request.allowFreeform === true &&
    Boolean(text);
  if (
    !match ||
    !request ||
    (!selected && !freeform) ||
    (selected && !request.options?.some((option) => option.id === selected))
  ) {
    await publishMatrixInputNotice(eventId, "ambiguous");
    return { handled: true as const };
  }
  // Capture the delivered native revision once. It is a reference to Eve's
  // immutable request, not an independently authoritative approval payload.
  const requestId = request.requestId;
  const revision = channelConsentRevision(request);
  const context = z
    .object({ events_before: z.array(promptEvent).optional() })
    .parse(
      await matrixRequest(
        "GET",
        `rooms/${encodeURIComponent(source.roomId)}/context/${encodeURIComponent(eventId)}?limit=40`,
        undefined,
        actor.matrixIdentityId
      )
    );
  const config = await matrixConfiguration();
  const delivered = context.events_before?.some((event) => {
    const reference = event.content["dev.zoen.input"];
    return (
      event.sender === config.botId &&
      reference?.eventId === match.candidate.eventId &&
      reference.requestId === requestId &&
      reference.revision === revision
    );
  });
  if (!delivered) {
    await publishMatrixInputNotice(eventId, "undelivered");
    return { handled: true as const };
  }
  // The native approval verifier reacquires these same fences. Commit admission
  // before handing the response to Eve; no SQL lock spans native resolution.
  const originalActor = await transaction(
    async () => {
      const currentActor = await matrixDeliveryActor(eventId);
      if (!sameMatrixRequester(actor, currentActor))
        throw new WorkspaceAccessDenied();
      await requireOriginalInputReceipt(
        match.candidate.eventId,
        match.session.id,
        actor
      );
      return currentActor;
    },
    { outermost: true }
  );
  // Take the observation cursor before the final snapshot, so concurrent native
  // settlement between that snapshot and respond cannot fall before our cursor.
  const tail = await match.session.getStreamTailIndex();
  const current = await withTimeout(
    () => readChannelInputs(match.session, operationSignal()),
    15_000
  );
  if (
    !current.some(
      (input) =>
        input.requestId === requestId &&
        channelConsentRevision(input) === revision
    )
  ) {
    await publishMatrixInputNotice(eventId, "resolved");
    return { handled: true as const };
  }
  const principal = matrixPrincipal(originalActor);
  const response = await match.session.respond(
    parseInputResponses([
      { requestId, ...(selected ? { optionId: selected } : { text }) },
    ]),
    {
      auth: {
        ...principal,
        attributes: {
          ...principal.attributes,
          matrixEventId: match.candidate.eventId,
        },
      },
    }
  );
  if (
    response.status !== "accepted" ||
    response.sessionId !== match.session.id
  ) {
    console.warn("Matrix input awaits active native session", {
      sessionId: match.session.id,
      retryable:
        response.status === "session_not_active" && response.retryable === true,
    });
    throw new MatrixError({ reason: "unavailable" });
  }
  // Queue acceptance is not decision consumption. Only the exact native
  // resolution can acknowledge this reply; publication has its own fences.
  const resolved = await withTimeout(
    () => matrixInputResolved(match.session, requestId, tail + 1),
    15_000
  ).catch(() => false);
  if (!resolved)
    console.warn("Accepted Matrix input awaits native resolution", {
      sessionId: match.session.id,
    });
  await transaction(
    async () => {
      const currentActor = await matrixDeliveryActor(eventId);
      if (!sameMatrixRequester(originalActor, currentActor))
        throw new WorkspaceAccessDenied();
      // A fast native turn may already have completed its original delivery.
      // Its exact receipt/session permits acknowledgment, never new output.
      await requireOriginalInputReceipt(
        match.candidate.eventId,
        match.session.id,
        currentActor
      );
      await query(sql`UPDATE matrix_deliveries SET state = ${resolved ? "completed" : "dispatched"}, updated_at = now()
      WHERE event_id = ${eventId} AND session_id IS NULL AND state IN ('pending', 'dispatched')`);
    },
    { outermost: true }
  );
  return { handled: true as const, session: match.session };
}

function sameMatrixRequester(
  left: Awaited<ReturnType<typeof matrixDeliveryActor>>,
  right: Awaited<ReturnType<typeof matrixDeliveryActor>>
) {
  return (
    left.userId === right.userId &&
    left.workspaceId === right.workspaceId &&
    left.matrixIdentityId === right.matrixIdentityId &&
    left.groupBindingId === right.groupBindingId &&
    left.groupEpoch === right.groupEpoch
  );
}

/** Under the reply's current admission, require the original's exact same
 * authority and receipt. A terminal original grants acknowledgment only; Eve's
 * native approval policy separately validates the original at settlement.
 */
async function requireOriginalInputReceipt(
  originalEventId: string,
  sessionId: string,
  actor: Awaited<ReturnType<typeof matrixDeliveryActor>>
) {
  const rows = await query(sql`SELECT d.event_id FROM matrix_deliveries d
    WHERE d.event_id = ${originalEventId} AND d.binding_id = ${actor.groupBindingId}
      AND d.epoch = ${actor.groupEpoch} AND d.user_id = ${actor.userId}
      AND d.session_id = ${sessionId} AND d.state IN ('pending', 'dispatched', 'answer_ready', 'completed')
      AND EXISTS (SELECT 1 FROM native_delivery_receipts r
        WHERE r.workspace_id = ${actor.workspaceId} AND r.input_id = d.event_id
          AND r.session_id = ${sessionId}) FOR SHARE OF d`);
  if (rows.length !== 1) throw new WorkspaceAccessDenied();
}

async function matrixInputResolved(
  session: Session,
  requestId: string,
  startIndex: number
) {
  const signal = operationSignal();
  const reader = (await session.getEventStream({ startIndex })).getReader();
  const cancel = () => {
    void reader.cancel();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const event = await reader.read();
      if (event.done) return false;
      if (
        event.value.type === "input.resolved" &&
        event.value.data.resolutions.some(
          (resolution) => resolution.requestId === requestId
        )
      )
        return true;
      if (
        event.value.type === "session.failed" ||
        event.value.type === "session.completed"
      )
        return false;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel();
  }
}

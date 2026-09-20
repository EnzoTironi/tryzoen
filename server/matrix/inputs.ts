import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { ChannelReceiveContext, Session } from "eve/channels";
import { parseInputResponses, type InputRequest } from "eve/client";
import { query } from "@db/queries";
import {
  readChannelInputs,
  renderChannelInput,
} from "../../agent/lib/channel-input";
import { channelConsentRevision } from "../../agent/lib/channel-consent";
import type { DeliveryState } from "../../agent/lib/durable-delivery";
import { operationSignal, withTimeout } from "../operations/async";
import { withNativeDeliveryLock } from "../messaging/native-receipts";
import { matrixDeliveryActor, matrixPrincipal } from "./authority";
import { matrixConfiguration, matrixRequest, MatrixError } from "./client";
import { finishMatrixEvent } from "./delivery";

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
  await matrixDeliveryActor(eventId);
  const rows = await query<{
    roomId: string;
  }>(sql`SELECT b.conversation_id AS "roomId" FROM matrix_deliveries d
    JOIN workspace_group_bindings b ON b.id = d.binding_id WHERE d.event_id = ${eventId}`);
  const room = rows[0];
  if (!room) return;
  const bound =
    await query(sql`UPDATE matrix_deliveries SET session_id = ${sessionId}, state = 'dispatched', updated_at = now()
    WHERE event_id = ${eventId} AND state IN ('pending', 'dispatched') AND (session_id IS NULL OR session_id = ${sessionId}) RETURNING event_id`);
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
        ? "\n\nSomente quem pediu pode decidir. Responda “Zoen aprovar” ou “Zoen cancelar”."
        : "\n\nQuem fez o pedido pode responder mencionando Zoen e a opção escolhida.";
    await matrixDeliveryActor(eventId);
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/zoen_input_${key}`,
      {
        msgtype: "m.text",
        body: renderChannelInput(request) + instructions,
        "m.relates_to": { "m.in_reply_to": { event_id: eventId } },
        "dev.zoen.input": reference,
      }
    );
  }
}

/** A named, exact decision can only answer one previously delivered request by its original sender. */
export async function respondToMatrixInput(
  eventId: string,
  channel: ChannelReceiveContext<DeliveryState>
) {
  const actor = await matrixDeliveryActor(eventId);
  const rows = await query<{
    message: string;
    roomId: string;
  }>(sql`SELECT d.message, b.conversation_id AS "roomId"
    FROM matrix_deliveries d JOIN workspace_group_bindings b ON b.id = d.binding_id WHERE d.event_id = ${eventId}`);
  const source = rows[0];
  const text = source?.message.replace(/^\s*@?zoen\b[\s,:]*/iu, "").trim();
  const optionId = /^(approve|aprovar|aprobar)[.!]?$/iu.test(text ?? "")
    ? "approve"
    : /^(cancel|cancelar)[.!]?$/iu.test(text ?? "")
      ? "cancel"
      : null;
  if (!source) return { handled: false as const };
  const candidates = await query<{
    eventId: string;
    sessionId: string;
  }>(sql`SELECT d.event_id AS "eventId", d.session_id AS "sessionId"
    FROM matrix_deliveries d JOIN matrix_deliveries current ON current.event_id = ${eventId}
    WHERE d.binding_id = current.binding_id AND d.epoch = current.epoch AND d.user_id = current.user_id
      AND d.state = 'dispatched' AND d.session_id IS NOT NULL AND d.created_at < current.created_at
    ORDER BY d.created_at DESC LIMIT 25`);
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
            option.id.toLowerCase() === text?.toLowerCase() ||
            option.label.toLowerCase() === text?.toLowerCase()
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
    await finishMatrixEvent(
      eventId,
      "Não encontrei uma única solicitação pendente que corresponda à sua resposta neste grupo. Nenhuma ação foi autorizada."
    );
    return { handled: true as const };
  }
  return withNativeDeliveryLock(
    `matrix-input:${match.session.id}`,
    async () => {
      const current = await readChannelInputs(match.session, operationSignal());
      if (
        !current.some(
          (input) =>
            input.requestId === request.requestId &&
            channelConsentRevision(input) === channelConsentRevision(request)
        )
      ) {
        await finishMatrixEvent(
          eventId,
          "Esta solicitação já foi respondida. Nenhuma nova ação foi autorizada."
        );
        return { handled: true as const };
      }
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
          reference.requestId === match.request.requestId &&
          reference.revision === channelConsentRevision(match.request)
        );
      });
      if (!delivered) {
        await finishMatrixEvent(
          eventId,
          "Não consegui confirmar a proposta entregue antes desta resposta. Nenhuma ação foi autorizada."
        );
        return { handled: true as const };
      }
      const originalActor = await matrixDeliveryActor(match.candidate.eventId);
      await matrixDeliveryActor(eventId);
      if (
        originalActor.userId !== actor.userId ||
        originalActor.workspaceId !== actor.workspaceId
      )
        throw new Error("Matrix approval requester changed");
      const principal = matrixPrincipal(originalActor);
      const tail = await match.session.getStreamTailIndex();
      const response = await match.session.respond(
        parseInputResponses([
          {
            requestId: request.requestId,
            ...(selected ? { optionId: selected } : { text }),
          },
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
            response.status === "session_not_active" &&
            response.retryable === true,
        });
        throw new MatrixError({ reason: "unavailable" });
      }
      // Acceptance queues an input response; it does not mean Eve consumed it.
      // Keep the session lock until its exact native request has settled.
      const resolved = await withTimeout(
        () => matrixInputResolved(match.session, request.requestId, tail + 1),
        15_000
      ).catch(() => false);
      if (!resolved)
        console.warn("Accepted Matrix input awaits native resolution", {
          sessionId: match.session.id,
        });
      await query(sql`UPDATE matrix_deliveries SET state = ${resolved ? "completed" : "dispatched"}, session_id = ${match.session.id}, updated_at = now()
    WHERE event_id = ${eventId} AND state IN ('pending', 'dispatched')`);
      return { handled: true as const, session: match.session };
    }
  );
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

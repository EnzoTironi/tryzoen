import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { operationSignal, withTimeout } from "../../server/operations/async";
import type { z } from "zod";
import type { Session } from "eve/channels";
import type { MessageStreamEvent } from "eve/client";
import type { internalCallbackBodies } from "../../server/internal/callback-auth";
import { Messaging, MessagePayloadSchema } from "../../server/messaging";
import { ChannelTransport } from "../../server/channels/transport";
import { channelProviderSchema } from "../../shared/identity/channel-auth";
import { readChannelInputs } from "./channel-input";
import {
  channelConsentRevision,
  validateChannelConsent,
} from "./channel-consent";
import { channelPrincipal } from "../../server/channels/principal";
type ResponseInput = z.output<
  (typeof internalCallbackBodies)["/internal/channel-input/respond"]
>;
export class ChannelResponseRejected extends Error {
  readonly _tag = "ChannelResponseRejected";
  declare readonly reason: string;
  constructor(input: { readonly reason: string }) {
    super("ChannelResponseRejected");
    this.name = "ChannelResponseRejected";
    Object.assign(this, input);
  }
}
export class ChannelResponseUncertain extends Error {
  readonly _tag = "ChannelResponseUncertain";
  constructor() {
    super("ChannelResponseUncertain");
    this.name = "ChannelResponseUncertain";
  }
}
const readResponseIdentity = async function (identityId: string) {
  const rows = await query(
    sql`SELECT channel FROM channel_identity WHERE id = ${identityId}`
  );
  const channel = await channelProviderSchema.parseAsync(rows[0]?.channel);
  const transport = ChannelTransport;
  return await transport.activeIdentity(identityId, channel);
};
export const readChannelResponseContext = async function (
  input: ResponseInput
) {
  const identity = await readResponseIdentity(input.identityId);
  const rows = await query(sql`SELECT payload FROM channel_inbox
    WHERE identity_id = ${input.identityId} AND source_message_id = ${input.sourceMessageId}
      AND status = 'accepted' AND session_id = ${input.sessionId} LIMIT 2`);
  if (rows.length !== 1) {
    throw new ChannelResponseRejected({
      reason: "invalid_source",
    });
  }
  const payload = await MessagePayloadSchema.parseAsync(rows[0]?.payload);
  if (!payload.text || payload.sourceOccurredAtMs === undefined) {
    throw new ChannelResponseRejected({
      reason: "invalid_source",
    });
  }
  const source = {
    identityId: input.identityId,
    sessionId: input.sessionId,
    sourceMessageId: input.sourceMessageId,
    text: payload.text,
    sourceOccurredAtMs: payload.sourceOccurredAtMs,
  };
  return {
    identity,
    source,
  };
};
export async function readChannelResponseTurnStream(
  stream: ReadableStream<MessageStreamEvent>,
  tail: number,
  source: {
    readonly turnId: string;
    readonly text: string;
  },
  signal: AbortSignal
) {
  const reader = stream.getReader();
  const cancel = () => {
    void reader.cancel();
  };
  signal.addEventListener("abort", cancel, {
    once: true,
  });
  let activeTurnId: string | undefined;
  let matchingMessages = 0;
  let exactText = false;
  let closed = false;
  try {
    for (let index = 0; index <= tail; index++) {
      signal.throwIfAborted();
      const item = await reader.read();
      if (item.done)
        throw new Error("Session stream ended before its captured tail.");
      const event = item.value;
      if (event.type === "turn.started") activeTurnId = event.data.turnId;
      if (
        event.type === "message.received" &&
        event.data.turnId === source.turnId
      ) {
        matchingMessages++;
        exactText = event.data.message === source.text;
      }
      if (
        (event.type === "turn.completed" ||
          event.type === "turn.cancelled" ||
          event.type === "turn.failed") &&
        event.data.turnId === source.turnId
      )
        closed = true;
    }
    signal.throwIfAborted();
    return (
      activeTurnId === source.turnId &&
      matchingMessages === 1 &&
      exactText &&
      !closed
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel();
  }
}
const requireResponseTurn = async function (
  session: Session,
  source: {
    readonly turnId: string;
    readonly text: string;
  }
) {
  const matches = await Promise.try(async () => {
    return await (async (signal) => {
      const tail = await session.getStreamTailIndex();
      if (tail < 0) return false;
      return readChannelResponseTurnStream(
        await session.getEventStream({
          startIndex: 0,
        }),
        tail,
        source,
        signal
      );
    })(operationSignal());
  }).catch(() => {
    throw new ChannelResponseRejected({
      reason: "turn_unavailable",
    });
  });
  if (!matches)
    throw new ChannelResponseRejected({
      reason: "source_turn_mismatch",
    });
  return undefined;
};
const prepareChannelResponse = async function (
  input: ResponseInput,
  session: Session
) {
  if (session.id !== input.sessionId) {
    throw new ChannelResponseRejected({
      reason: "session_mismatch",
    });
  }
  const { identity, source } = await readChannelResponseContext(input);
  await requireResponseTurn(session, {
    turnId: input.turnId,
    text: source.text,
  });
  const pending = await withTimeout(async () => {
    try {
      return await ((signal) => readChannelInputs(session, signal))(
        operationSignal()
      );
    } catch {
      throw new ChannelResponseRejected({
        reason: "pending_unavailable",
      });
    }
  }, 8000);
  const request = pending.find(
    (candidate) => candidate.requestId === input.requestId
  );
  if (!request)
    throw new ChannelResponseRejected({
      reason: "stale_request",
    });
  const reference = {
    requestId: request.requestId,
    revision: channelConsentRevision(request),
  };
  const transport = ChannelTransport;
  const delivery = await transport.deliveredInput(identity.id, {
    ...reference,
    sessionId: session.id,
  });
  const decision = validateChannelConsent(
    source,
    {
      sourceMessageId: source.sourceMessageId,
      sourceText: source.text,
      candidate: {
        intent: input.decision,
        references: [reference],
      },
    },
    {
      identityId: identity.id,
      sessionId: session.id,
      pending,
      deliveries: delivery ? [delivery] : [],
      consumedSourceMessageIds: [],
    }
  );
  if (decision.status !== "validated") {
    throw new ChannelResponseRejected({
      reason:
        decision.status === "rejected" ? decision.reason : "invalid_decision",
    });
  }
  return {
    decision,
    auth: channelPrincipal(identity, source.sourceMessageId),
  };
};
export const submitChannelResponse = async function (
  input: ResponseInput,
  session: Session
) {
  const prepared = await withTimeout(
    async () => prepareChannelResponse(input, session),
    8000
  );
  const messaging = Messaging;
  const claim = await messaging.claimChannelInputResponse({
    ...input,
    revision: prepared.decision.binding.revision,
  });
  if (claim.kind === "conflict") {
    throw new ChannelResponseRejected({
      reason: "response_conflict",
    });
  }
  if (claim.kind === "duplicate") {
    if (claim.status === "accepted") return undefined;
    throw new ChannelResponseUncertain();
  }
  try {
    await withTimeout(async () => {
      const current = await prepareChannelResponse(input, session);
      if (
        current.decision.binding.revision !== prepared.decision.binding.revision
      ) {
        throw new ChannelResponseRejected({
          reason: "stale_revision",
        });
      }
      const result = await Promise.try(async () =>
        session.respond([current.decision.response], {
          auth: current.auth,
        })
      ).catch(() => {
        throw new ChannelResponseUncertain();
      });
      if (result.status !== "accepted" || result.sessionId !== session.id) {
        throw new ChannelResponseUncertain();
      }
      const marked = await messaging.markChannelInputResponse({
        id: claim.id,
        status: "accepted",
      });
      if (!marked) throw new ChannelResponseUncertain();
      return undefined;
    }, 8000);
  } catch (error) {
    await messaging.markChannelInputResponse({
      id: claim.id,
      status: "uncertain",
    });
    throw error;
  }
  return undefined;
};

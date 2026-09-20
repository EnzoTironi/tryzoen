import { z } from "zod";
import { renderChannelInput } from "./channel-input";
import { channelConsentRevision } from "./channel-consent";
import { createHash } from "node:crypto";

import type { ChannelEvents, ChannelSendOptions } from "eve/channels";
import type { Identity } from "../../server/accounts";
import { ChannelTransport } from "../../server/channels/transport";
import { requireChannelPrincipal } from "../../server/channels/principal";

const groupDeliveryAttributesSchema = z.object({
  groupChatId: z.optional(
    z
      .string()
      .min(1)
      .refine((value) => value === value.trim(), "Expected trimmed text")
  ),
  sourceMessageId: z.optional(
    z
      .string()
      .min(1)
      .refine((value) => value === value.trim(), "Expected trimmed text")
  ),
});

function telegramGroupDelivery(
  channel: Identity["channel"],
  auth: ChannelSendOptions["auth"]
) {
  if (channel !== "telegram" || !auth) return undefined;
  const attributes = ((parsed) => (parsed.success ? parsed.data : undefined))(
    groupDeliveryAttributesSchema.safeParse(auth.attributes)
  );
  if (!attributes?.groupChatId) return undefined;
  if (!attributes.sourceMessageId) {
    return { deliveryTargetId: attributes.groupChatId };
  }
  return {
    deliveryTargetId: attributes.groupChatId,
    replyToMessageId: attributes.sourceMessageId,
  };
}

function enqueueDeliveredText(
  enqueue: (typeof ChannelTransport)["enqueueText"],
  channel: Identity["channel"],
  auth: ChannelSendOptions["auth"],
  input: {
    readonly identityId: string;
    readonly deliveryKey: string;
    readonly text: string;
    readonly inputRequest?: {
      readonly sessionId: string;
      readonly requestId: string;
      readonly revision: string;
    };
  }
) {
  const delivery = telegramGroupDelivery(channel, auth);
  if (!delivery) return enqueue(input);
  if (!delivery.replyToMessageId) {
    return enqueue({
      ...input,
      deliveryTargetId: delivery.deliveryTargetId,
    });
  }
  return enqueue({
    ...input,
    deliveryTargetId: delivery.deliveryTargetId,
    replyToMessageId: delivery.replyToMessageId,
  });
}

export function privateChannelEvents(channel: Identity["channel"]) {
  const terminal = (
    ...[event, _channel, context]: Parameters<
      NonNullable<ChannelEvents<unknown>["turn.cancelled"]>
    >
  ) => {
    if (context.session.parent) return Promise.resolve();
    return (async function () {
      const auth =
        context.session.auth.current ?? context.session.auth.initiator ?? null;
      const identity = await requireChannelPrincipal(channel, auth);
      const transport = ChannelTransport;
      await enqueueDeliveredText(transport.enqueueText, channel, auth, {
        identityId: identity.id,
        deliveryKey: `turn-status:${context.session.id}:${event.turnId}`,
        text: "This turn ended before completion.",
      });
    })();
  };
  return {
    "message.completed": (event, _channel, context) => {
      const text = event.message;
      if (
        context.session.parent ||
        !text?.trim() ||
        text.trim() === "DELIVERY_COMPLETE" ||
        event.finishReason === "tool-calls"
      )
        return Promise.resolve();
      return (async function () {
        const auth =
          context.session.auth.current ??
          context.session.auth.initiator ??
          null;
        const identity = await requireChannelPrincipal(channel, auth);
        const transport = ChannelTransport;
        const enqueue = transport.enqueueText;
        await enqueueDeliveredText(enqueue, channel, auth, {
          identityId: identity.id,
          deliveryKey: `message:${context.session.id}:${event.turnId}:${String(event.stepIndex)}:${String(event.sequence)}`,
          text,
        });
        await transport.drainOutbox(identity.id);
      })();
    },
    "input.requested": (event, _channel, context) =>
      enqueueInput(channel, event, context),
    "authorization.required": (event, _channel, context) =>
      enqueueAuthorization(channel, event, context),
    "turn.failed": terminal,
    "turn.cancelled": terminal,
  } satisfies Pick<
    ChannelEvents<unknown>,
    | "message.completed"
    | "authorization.required"
    | "input.requested"
    | "turn.failed"
    | "turn.cancelled"
  >;
}

function enqueueAuthorization(
  channel: Identity["channel"],
  event: Parameters<
    NonNullable<ChannelEvents<unknown>["authorization.required"]>
  >[0],
  context: Parameters<
    NonNullable<ChannelEvents<unknown>["authorization.required"]>
  >[2]
) {
  if (context.session.parent) return Promise.resolve();
  return (async function () {
    const auth =
      context.session.auth.current ?? context.session.auth.initiator ?? null;
    const identity = await requireChannelPrincipal(channel, auth);
    const transport = ChannelTransport;
    const challenge = event.authorization;
    const text = [
      `Connect ${challenge?.displayName ?? event.name}`,
      event.description,
      challenge?.instructions,
      challenge?.userCode ? `Code: ${challenge.userCode}` : undefined,
      challenge?.url,
    ]
      .filter((line) => line !== undefined)
      .join("\n\n");
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          context.session.id,
          event.turnId,
          event.stepIndex,
          event.name,
          event.attemptId ?? event.sequence,
        ])
      )
      .digest("hex");
    await enqueueDeliveredText(transport.enqueueText, channel, auth, {
      identityId: identity.id,
      deliveryKey: `authorization:${key}`,
      text,
    });
  })();
}

function enqueueInput(
  channel: Identity["channel"],
  event: Parameters<NonNullable<ChannelEvents<unknown>["input.requested"]>>[0],
  context: Parameters<NonNullable<ChannelEvents<unknown>["input.requested"]>>[2]
) {
  if (context.session.parent) return Promise.resolve();
  return (async function () {
    const auth =
      context.session.auth.current ?? context.session.auth.initiator ?? null;
    const identity = await requireChannelPrincipal(channel, auth);
    const transport = ChannelTransport;
    for (const request of event.requests) {
      await enqueueDeliveredText(transport.enqueueText, channel, auth, {
        identityId: identity.id,
        deliveryKey: `input:${context.session.id}:${request.requestId}`,
        text: renderChannelInput(request),
        inputRequest: {
          sessionId: context.session.id,
          requestId: request.requestId,
          revision: channelConsentRevision(request),
        },
      });
    }
    await transport.drainOutbox(identity.id);
  })();
}

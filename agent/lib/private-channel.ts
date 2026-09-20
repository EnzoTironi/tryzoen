import { mapAsync } from "../../server/operations/async";
import { env } from "@shared/environment/env";
import { withSignal } from "../../server/operations/async";
import {
  deliveryContext,
  deliverOnce,
  type DeliveryState,
} from "./durable-delivery";
import { ChannelAccountError } from "../../server/accounts";
import { ChannelAuthPromptError } from "../../server/channel-auth/prompts";
import { PayloadConflict } from "../../server/messaging/model";
import { WebhookRejected } from "../../server/channels/webhook";
import { defineChannel, POST, type ChannelDefinition } from "eve/channels";
import { ChannelAccounts, type Identity } from "../../server/accounts";
import { Messaging, type Lease } from "../../server/messaging";
import { ChannelAuthPrompts } from "../../server/channel-auth/prompts";
import { ChannelTransport } from "../../server/channels/transport";
import {
  dispatchAuthFeedback,
  dispatchAuthPrompt,
  dispatchItem,
  dispatchUnlinkedSenderPrompt,
  signInUrl,
  unlinkedSenderCopy,
} from "../../server/channels/dispatch";
import { bindGroupChannelIdentity } from "../../server/channels/group-policy";
import type { InboundEvent } from "../../server/channels/inbound";
import { Telegram } from "../../server/channels/telegram";
import { Kapso } from "../../server/channels/kapso";
import { readVerifiedWebhook } from "../../server/channels/webhook";
import { drainChannelInbox, handoffChannelMessage } from "./channel-session";
import { privateChannelEvents } from "./private-channel-events";
import { ProviderInputError } from "../../server/channels/provider-errors";

type Acceptance =
  | { readonly status: "accepted"; readonly identity: Identity }
  | { readonly status: "unlinked"; readonly prompt: boolean };

const acceptChannelMessage = async function (
  event: Extract<InboundEvent, { kind: "message" }>
) {
  const accounts = ChannelAccounts;
  const resolution = await accounts.resolveVerifiedSender({
    channel: event.channel,
    installationId: event.installationId,
    senderId: event.senderId,
  });
  if (resolution.status === "unlinked") {
    if (event.chatKind === "group")
      return { status: "unlinked", prompt: false } satisfies Acceptance;
    const contact = await accounts.recordUnlinkedContact(resolution.sender);
    return { status: "unlinked", prompt: contact.prompt } satisfies Acceptance;
  }
  const { identity } = resolution;
  const group =
    event.chatKind === "group"
      ? await bindGroupChannelIdentity({
          identityId: identity.id,
          channel: event.channel,
          installationId: event.installationId,
          senderId: event.senderId,
          chatId: event.chatId,
        })
      : undefined;
  const payload = {
    ...event.payload,
    sourceOccurredAtMs: new Date(event.occurredAt).getTime(),
  };
  await Messaging.accept({
    identityId: identity.id,
    eventId: event.eventId,
    sourceMessageId: event.messageId,
    payload: group
      ? {
          ...payload,
          deliveryTargetId: group.deliveryTargetId,
          conversationScope: group.conversationScope,
        }
      : payload,
  });
  return { status: "accepted", identity } satisfies Acceptance;
};

function channelInputResponse(
  channel: Identity["channel"],
  error: ProviderInputError
) {
  if (
    channel === "telegram" &&
    ["invalid_command", "stale_event"].includes(error.reason)
  ) {
    console.info("Telegram update refused", { reason: error.reason });
    return new Response("ignored");
  }
  console.warn("Channel input rejected", { channel, reason: error.reason });
  return new Response("invalid event", {
    status: error.reason === "configuration" ? 503 : 400,
  });
}

async function acceptLoginCommand(
  event: Extract<InboundEvent, { kind: "command" }>
) {
  try {
    const sender = {
      channel: event.channel,
      installationId: event.installationId,
      senderId: event.senderId,
    };
    if (event.command === "confirm") {
      await ChannelAccounts.confirmChallenge({ token: event.token, sender });
      return { status: "confirmed" as const };
    }
    const prompt = await ChannelAuthPrompts.prepare({
      token: event.token,
      sender,
      eventId: event.eventId,
    });
    return { status: "prompt" as const, challengeId: prompt.challengeId };
  } catch (error) {
    if (
      error instanceof ChannelAccountError ||
      (error instanceof ChannelAuthPromptError &&
        ["invalid_input", "conflict"].includes(error.reason))
    ) {
      console.info("Channel login command refused", {
        channel: event.channel,
        reason: error.reason,
      });
      return { status: "refused" as const, reason: error.reason };
    }
    throw error;
  }
}

export function privateChannel(channel: Identity["channel"]) {
  const definition: ChannelDefinition<
    DeliveryState,
    ReturnType<typeof deliveryContext>,
    Lease
  > = {
    turnPolicy: "queue",
    state: { receipts: {} },
    context: deliveryContext,
    deliver: deliverOnce,
    routes: [
      POST(`/channels/${channel}`, (request, context) =>
        withSignal(request.signal, async () => {
          try {
            const secret =
              env[
                channel === "telegram"
                  ? "TELEGRAM_WEBHOOK_SECRET"
                  : "KAPSO_WEBHOOK_SECRET"
              ];
            if (!secret)
              throw new ProviderInputError({
                provider: channel,
                reason: "configuration",
              });
            const body = await readVerifiedWebhook(request, channel, secret);
            const provider = channel === "telegram" ? Telegram : Kapso;
            const events = await provider.parse(body);
            const identities = new Map<string, Identity>();
            const prompts: string[] = [];
            for (const event of events) {
              if (event.kind === "command") {
                const result = await acceptLoginCommand(event);
                if (result.status === "prompt") {
                  prompts.push(result.challengeId);
                } else {
                  const refusal =
                    result.status === "refused" &&
                    result.reason === "sender_unlinked"
                      ? unlinkedSenderCopy(
                          event.channel,
                          await signInUrl(event.channel)
                        )
                      : undefined;
                  context.waitUntil(
                    dispatchItem(
                      event.eventId,
                      dispatchAuthFeedback(
                        event,
                        result.status === "confirmed",
                        refusal
                      )
                    )
                  );
                }
              } else {
                const acceptance = await acceptChannelMessage(event);
                if (acceptance.status === "accepted")
                  identities.set(acceptance.identity.id, acceptance.identity);
                else if (acceptance.prompt)
                  context.waitUntil(
                    dispatchItem(
                      event.eventId,
                      dispatchUnlinkedSenderPrompt(event)
                    )
                  );
              }
            }
            // ACK only after inputs and login prompts have durable receipts.
            context.waitUntil(
              (async () => {
                await mapAsync(
                  prompts,
                  (id) => dispatchItem(id, dispatchAuthPrompt(id)),
                  4
                );
                await mapAsync(
                  [...identities.values()],
                  async (identity) => {
                    await dispatchItem(
                      identity.id,
                      drainChannelInbox(identity, context)
                    );
                    await dispatchItem(
                      identity.id,
                      ChannelTransport.drainOutbox(identity.id)
                    );
                  },
                  4
                );
              })()
            );
            return new Response("ok");
          } catch (error) {
            if (error instanceof WebhookRejected)
              return new Response("rejected", { status: error.status });
            if (error instanceof ProviderInputError)
              return channelInputResponse(channel, error);
            if (error instanceof ChannelAccountError)
              return new Response("invalid challenge or identity", {
                status: 400,
              });
            if (error instanceof PayloadConflict)
              return new Response("conflicting replay", { status: 409 });
            console.error("Channel acceptance failed", {
              tag: error instanceof Error ? error.name : "unknown",
            });
            return new Response("unavailable", { status: 503 });
          }
        })
      ),
    ],
    receive: ({ target, auth }, context) =>
      handoffChannelMessage(channel, target, auth, context),
    events: privateChannelEvents(channel),
  };
  return defineChannel(definition);
}

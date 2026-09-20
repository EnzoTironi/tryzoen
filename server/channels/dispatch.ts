import { mapAsync } from "../operations/async";
import { ProviderUncertain } from "./provider-errors";
import { ProviderRejected } from "./provider-errors";
import { env } from "@shared/environment/env";
import { applicationOrigin } from "@shared/environment/origin";
import { ChannelAuthPrompts } from "../channel-auth/prompts";
import { Telegram } from "./telegram";
import { Kapso } from "./kapso";
import { ProviderInputError } from "./provider-errors";
import type { InboundEvent } from "./inbound";

export const dispatchItem = async function <A>(
  itemId: string,
  operation: Promise<A>
) {
  await Promise.try(async () => operation).catch((cause: unknown) => {
    console.error("Channel dispatch item failed", {
      itemId,
      errorType: cause instanceof Error ? cause.name : "UnknownError",
    });
  });
};

export const dispatchAuthFeedback = async function (
  event: Extract<InboundEvent, { kind: "command" }>,
  confirmed: boolean,
  refusalMessage?: string
) {
  const refusal =
    refusalMessage ??
    "This request cannot be confirmed here. Return to your original Zoen browser tab to check it or start a new request.";
  if (event.channel === "kapso") {
    await Kapso.sendText(
      event.senderId,
      confirmed
        ? "Confirmado. Volte à aba do Zoen onde você começou para continuar."
        : refusal
    );
    return;
  }
  const provider = Telegram;
  if (event.command === "start") {
    await provider.sendText(event.chatId, refusal);
    return;
  }
  if (!event.callbackQueryId) return;
  // The database outcome stands even if Telegram can no longer show the toast.
  await dispatchItem(
    event.eventId,
    provider.answerCallbackQuery(
      event.callbackQueryId,
      confirmed
        ? "Confirmed. Return to your original Zoen browser tab to finish."
        : refusal,
      !confirmed
    )
  );
  if (confirmed) {
    await provider.editLoginConfirmation(event.chatId, event.messageId);
  }
};

export const unlinkedSenderCopy = (
  channel: InboundEvent["channel"],
  signInUrl: string
) =>
  channel === "kapso"
    ? `Este número ainda não está vinculado a uma conta Zoen. Entre com Google em ${signInUrl} e vincule o WhatsApp em Conta para continuar.`
    : `This Telegram account is not linked to Zoen yet. Sign in with Google at ${signInUrl}, then link Telegram from your account to continue.`;

export const signInUrl = async (channel: InboundEvent["channel"]) => {
  try {
    return `${applicationOrigin()}/sign-in`;
  } catch {
    throw new ProviderInputError({
      provider: channel,
      reason: "configuration",
    });
  }
};

export const dispatchUnlinkedSenderPrompt = async function (
  event: Extract<InboundEvent, { kind: "message" }>
) {
  const copy = unlinkedSenderCopy(
    event.channel,
    await signInUrl(event.channel)
  );
  if (event.channel === "kapso") {
    await Kapso.sendText(event.senderId, copy);
    return;
  }
  await Telegram.sendText(event.chatId, copy);
};

export const dispatchAuthPrompt = async function (challengeId: string) {
  const prompts = ChannelAuthPrompts;
  const claim = await prompts.claim(challengeId);
  if (!claim) return;
  const send = async () => {
    const installation =
      env[
        claim.channel === "telegram"
          ? "TELEGRAM_BOT_ID"
          : "KAPSO_PHONE_NUMBER_ID"
      ];
    if (installation !== claim.installationId)
      throw new ProviderInputError({
        provider: claim.channel,
        reason: "wrong_installation",
      });
    const provider = claim.channel === "telegram" ? Telegram : Kapso;
    await prompts.checkLease(claim.lease);
    return await provider.sendLoginConfirmation(
      claim.senderId,
      claim.token,
      claim.purpose
    );
  };
  try {
    const result = await send();
    await prompts.markSent(claim.lease, result.providerMessageId);
  } catch (error) {
    if (
      error instanceof ProviderRejected ||
      error instanceof ProviderInputError
    ) {
      await prompts.markRejected(claim.lease);
      return;
    }
    if (error instanceof ProviderUncertain) {
      await prompts.markUncertain(claim.lease);
      return;
    }
    throw error;
  }
};

export const drainAuthPrompts = async () => {
  const prompts = ChannelAuthPrompts;
  const pending = await prompts.pending(25);
  await mapAsync(pending, (id) => dispatchItem(id, dispatchAuthPrompt(id)), 4);
};

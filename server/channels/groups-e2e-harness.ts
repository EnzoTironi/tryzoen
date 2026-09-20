import type { z } from "zod";

import { bindGroupChannelIdentity } from "./group-policy";
import { parseTelegramUpdate, type TelegramInstallation } from "./telegram";
import type { InboundEvent } from "./inbound";

export interface TelegramGroupHarnessResult {
  readonly accepted: boolean;
  readonly events: readonly InboundEvent[];
  readonly binding: {
    readonly identityId: string;
    readonly channel: "telegram";
    readonly installationId: string;
    readonly senderId: string;
    readonly chatId: string;
    readonly chatKind: "group";
    readonly conversationScope: string;
    readonly deliveryTargetId: string;
  } | null;
  readonly reason:
    | "accepted_and_bound"
    | "dropped_by_mention_policy_or_empty"
    | "not_group_event";
}

/**
 * Fixture/e2e harness: parse Telegram update → require group message →
 * bindGroupChannelIdentity. Direct async calls; no network.
 */
export const runTelegramGroupMentionHarness = async function (input: {
  readonly update: z.core.util.JSONType;
  readonly installation: TelegramInstallation;
  readonly nowMs: number;
  readonly identityId: string;
}) {
  const events = await Promise.try(async () =>
    parseTelegramUpdate(input.update, input.installation, input.nowMs)
  ).catch(() => [] as const);
  const event = events[0];
  if (!event) {
    return {
      accepted: false,
      events,
      binding: null,
      reason: "dropped_by_mention_policy_or_empty",
    } satisfies TelegramGroupHarnessResult;
  }
  if (event.chatKind !== "group") {
    return {
      accepted: false,
      events,
      binding: null,
      reason: "not_group_event",
    } satisfies TelegramGroupHarnessResult;
  }
  const binding = await Promise.try(async () =>
    bindGroupChannelIdentity({
      identityId: input.identityId,
      channel: "telegram",
      installationId: event.installationId,
      senderId: event.senderId,
      chatId: event.chatId,
    })
  ).catch(() => null);
  if (binding?.channel !== "telegram") {
    return {
      accepted: false,
      events,
      binding: null,
      reason: "dropped_by_mention_policy_or_empty",
    } satisfies TelegramGroupHarnessResult;
  }
  return {
    accepted: true,
    events,
    binding: {
      identityId: binding.identityId,
      channel: "telegram",
      installationId: binding.installationId,
      senderId: binding.senderId,
      chatId: binding.chatId,
      chatKind: "group",
      conversationScope: binding.conversationScope,
      deliveryTargetId: binding.deliveryTargetId,
    },
    reason: "accepted_and_bound",
  } satisfies TelegramGroupHarnessResult;
};

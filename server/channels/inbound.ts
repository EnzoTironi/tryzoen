import { z } from "zod";

import { MessagePayloadSchema, type MessagePayload } from "../messaging/model";
import { ProviderInputError } from "./provider-errors";

export const ProviderReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), "Expected trimmed text");
export const LoginTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const base = {
  channel: z.enum(["telegram", "kapso"]),
  installationId: ProviderReferenceSchema,
  eventId: ProviderReferenceSchema,
  senderId: ProviderReferenceSchema,
  messageId: ProviderReferenceSchema,
  occurredAt: z.string(),
  chatKind: z.enum(["private", "group"]),
  chatId: ProviderReferenceSchema,
};
const InboundEventSchema = z.union([
  z.object({
    ...base,
    kind: z.literal("message"),
    payload: MessagePayloadSchema,
  }),
  z.object({
    ...base,
    kind: z.literal("command"),
    command: z.enum(["start", "confirm"]),
    token: LoginTokenSchema,
    callbackQueryId: z.optional(ProviderReferenceSchema),
  }),
]);
export type InboundEvent = z.output<typeof InboundEventSchema>;
export type InboundCoordinates = Omit<
  Extract<InboundEvent, { kind: "message" }>,
  "kind" | "payload"
>;

export const validateEventAge = async function (
  channel: "telegram" | "kapso",
  timestampSeconds: number,
  nowMs: number
) {
  await Promise.try(async () => z.number().parseAsync(nowMs)).catch(() => {
    throw new ProviderInputError({ provider: channel, reason: "malformed" });
  });
  const milliseconds = timestampSeconds * 1000;
  if (milliseconds > nowMs + 60_000) {
    throw new ProviderInputError({
      provider: channel,
      reason: "future_event",
    });
  }
  if (milliseconds < nowMs - 86_400_000) {
    throw new ProviderInputError({
      provider: channel,
      reason: "stale_event",
    });
  }
  return new Date(milliseconds).toISOString();
};

export const normalizeInbound = async function (
  coordinates: InboundCoordinates,
  payload: MessagePayload,
  botUsername?: string
): Promise<InboundEvent | null> {
  const text = payload.text?.trim() ?? "";
  if (coordinates.chatKind === "group") {
    // Auth challenges stay private-only; groups never mint login/link commands.
    if (/^\/(?:start|confirm)(?:@|\s|$)/i.test(text)) return null;
  }
  const command =
    coordinates.chatKind !== "group" &&
    (coordinates.channel === "telegram" || /^\/start\s/i.test(text))
      ? /^\/(start|confirm)(?:@([A-Za-z0-9_]+))?(?:\s+(\S+))?\s*$/i.exec(text)
      : null;
  if (command?.[2] && command[2].toLowerCase() !== botUsername?.toLowerCase())
    return null;
  const greeting = command?.[1]?.toLowerCase() === "start" && !command[3];
  if (command && !greeting) {
    const token = await Promise.try(async () =>
      LoginTokenSchema.parseAsync(command[3])
    ).catch(() => {
      throw new ProviderInputError({
        provider: coordinates.channel,
        reason: "invalid_command",
      });
    });
    const action = command[1]?.toLowerCase() === "start" ? "start" : "confirm";
    return { ...coordinates, kind: "command", command: action, token };
  }
  if (
    coordinates.channel === "telegram" &&
    !greeting &&
    /^\/(?:start|confirm)(?:@|\s|$)/i.test(text)
  ) {
    throw new ProviderInputError({
      provider: coordinates.channel,
      reason: "invalid_command",
    });
  }
  if (!text && !payload.attachments?.length) return null;
  const candidate: Record<string, z.core.util.JSONType> = {};
  if (payload.text !== undefined) candidate.text = payload.text;
  if (payload.replyToMessageId !== undefined)
    candidate.replyToMessageId = payload.replyToMessageId;
  if (payload.attachments !== undefined)
    candidate.attachments = payload.attachments.map((attachment) => {
      const reference: Record<string, z.core.util.JSONType> = {
        id: attachment.id,
        mediaType: attachment.mediaType,
      };
      if (attachment.name !== undefined) reference.name = attachment.name;
      return reference;
    });
  const normalized = await Promise.try(async () =>
    MessagePayloadSchema.parseAsync(candidate)
  ).catch(() => {
    throw new ProviderInputError({
      provider: coordinates.channel,
      reason: "malformed",
    });
  });
  return { ...coordinates, kind: "message", payload: normalized };
};

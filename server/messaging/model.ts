import { z } from "zod";
import { createHash } from "node:crypto";
import { channelProviderSchema } from "../../shared/identity/channel-auth";
export const IdentityId = z.uuid();
const reference = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), "Expected trimmed text");
export const InputDeliveryReferenceSchema = z.strictObject({
  sessionId: reference,
  requestId: reference,
  revision: z.string().regex(/^[0-9a-f]{64}$/),
});
export const ClaimChannelInputResponseSchema = z.strictObject({
  ...InputDeliveryReferenceSchema.shape,
  identityId: IdentityId,
  sourceMessageId: reference,
  turnId: reference,
  decision: z.enum(["approve", "cancel"]),
});
export type ClaimChannelInputResponse = z.output<
  typeof ClaimChannelInputResponseSchema
>;
export const MarkChannelInputResponseSchema = z.strictObject({
  id: IdentityId,
  status: z.enum(["accepted", "uncertain"]),
});
export const MessagePayloadSchema = z
  .strictObject({
    inputRequest: z.optional(InputDeliveryReferenceSchema),
    sourceOccurredAtMs: z.optional(z.number().int().min(0)),
    text: z.optional(z.string().min(1).max(16_384)),
    attachments: z.optional(
      z
        .array(
          z.strictObject({
            id: reference,
            mediaType: z.string().min(1).max(128),
            name: z.optional(reference),
          })
        )
        .max(10)
    ),
    replyToMessageId: z.optional(reference),
    deliveryTargetId: z.optional(reference),
    conversationScope: z.optional(
      z
        .string()
        .min(1)
        .max(320)
        .refine((value) => value === value.trim(), "Expected trimmed text")
    ),
  })
  .refine(
    (message) =>
      Boolean(message.text?.trim()) || (message.attachments?.length ?? 0) > 0,
    {
      message: "A message needs text or an attachment reference.",
    }
  );
export type MessagePayload = z.output<typeof MessagePayloadSchema>;
export const AcceptInputSchema = z.strictObject({
  identityId: IdentityId,
  eventId: reference,
  sourceMessageId: reference,
  payload: MessagePayloadSchema,
});
export type AcceptInput = z.output<typeof AcceptInputSchema>;
export const EnqueueInputSchema = z.strictObject({
  identityId: IdentityId,
  deliveryKey: reference,
  payload: MessagePayloadSchema,
});
export type EnqueueInput = z.output<typeof EnqueueInputSchema>;
export const ClaimInputSchema = z.strictObject({
  identityId: IdentityId,
  leaseSeconds: z.number().int().min(1).max(300),
});
export type ClaimInput = z.output<typeof ClaimInputSchema>;
export const LeaseSchema = z.strictObject({
  identityId: IdentityId,
  id: IdentityId,
  leaseToken: IdentityId,
});
export type Lease = z.output<typeof LeaseSchema>;
const actorPrincipal = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), "Expected trimmed text");
const resolutionNote = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim(), "Expected trimmed text");
const providerMessageId = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), "Expected trimmed text");
const OutboxResolutionDecisionSchema = z.union([
  z.strictObject({
    kind: z.literal("mark_delivered"),
    providerMessageId,
  }),
  z.strictObject({
    kind: z.literal("cancel"),
    reason: z.enum(["operator_cancelled", "duplicate_confirmed", "abandoned"]),
  }),
  z.strictObject({
    kind: z.literal("authorize_retry"),
    acknowledgment: z.literal("duplicate_delivery_risk_accepted"),
  }),
]);
export type OutboxResolutionDecision = z.output<
  typeof OutboxResolutionDecisionSchema
>;
export const ResolveOutboxUncertainSchema = z.strictObject({
  identityId: IdentityId,
  id: IdentityId,
  decision: OutboxResolutionDecisionSchema,
  actorPrincipalId: actorPrincipal,
  note: z.optional(resolutionNote),
});
export type ResolveOutboxUncertainInput = z.output<
  typeof ResolveOutboxUncertainSchema
>;
export const DeliveryFailureSchema = z.enum([
  "adapter_rejected",
  "adapter_unavailable",
  "adapter_rate_limited",
  "handoff_unknown",
  "lease_expired",
  "identity_revoked",
]);
export type DeliveryFailure = z.output<typeof DeliveryFailureSchema>;
const MessageStatus = z.enum([
  "queued",
  "dispatching",
  "accepted",
  "sent",
  "uncertain",
  "failed",
  "cancelled",
]);
export const NativeInboxContentSchema = z.union([
  z.string().min(1),
  z
    .array(
      z.strictObject({
        type: z.literal("text"),
        text: z.string().min(1),
      })
    )
    .min(1),
]);
export const NativeInboxHandoffSchema = z
  .strictObject({
    protocol: z.literal("eve-keyed-input-v1"),
    inputId: IdentityId,
    channel: channelProviderSchema,
    // A private identity or an exact group conversation. The channel boundary
    // validates this persisted address against the verified source before send.
    address: z
      .string()
      .min(1)
      .max(320)
      .refine((value) => value === value.trim(), "Expected trimmed text"),
    principalId: z.string().min(1),
    content: z.nullable(NativeInboxContentSchema),
  })
  .strict();
export const ChannelTranscriptSchema = z
  .string()
  .refine((value) => value === value.trim(), "Expected trimmed text")
  .min(1)
  .max(3000)
  .refine((text) => text.isWellFormed());
export const PrepareInboxHandoffSchema = z.strictObject({
  lease: LeaseSchema,
  content: NativeInboxContentSchema,
  transcripts: z.array(ChannelTranscriptSchema).max(10),
});
const MessageReceiptSchema = z.strictObject({
  id: IdentityId,
  identityId: IdentityId,
  key: reference,
  sourceMessageId: z.nullable(reference),
  payload: MessagePayloadSchema,
  nativeInput: z.nullable(NativeInboxHandoffSchema),
  status: MessageStatus,
  attempts: z.number().int(),
  leaseToken: z.nullable(IdentityId),
  leaseExpiresAt: z.nullable(z.string()),
  resultId: z.nullable(z.string()),
  lastError: z.nullable(z.string()),
});
export const MessageClaimSchema = z.strictObject({
  ...MessageReceiptSchema.shape,
  status: z.literal("dispatching"),
  leaseToken: IdentityId,
  leaseExpiresAt: z.string(),
});
export type MessageClaim = z.output<typeof MessageClaimSchema>;
export class InvalidMessage extends Error {
  readonly _tag = "InvalidMessage";
  constructor(input: { readonly message: string }) {
    super(input.message);
    this.name = "InvalidMessage";
    Object.assign(this, input);
  }
}
export class IdentityInactive extends Error {
  readonly _tag = "IdentityInactive";
  declare readonly identityId: z.output<typeof IdentityId>;
  constructor(input: { readonly identityId: z.output<typeof IdentityId> }) {
    super("IdentityInactive");
    this.name = "IdentityInactive";
    Object.assign(this, input);
  }
}
export class PayloadConflict extends Error {
  readonly _tag = "PayloadConflict";
  declare readonly id: z.output<typeof IdentityId>;
  constructor(input: { readonly id: z.output<typeof IdentityId> }) {
    super("PayloadConflict");
    this.name = "PayloadConflict";
    Object.assign(this, input);
  }
}
export class LeaseLost extends Error {
  readonly _tag = "LeaseLost";
  declare readonly id: z.output<typeof IdentityId>;
  constructor(input: { readonly id: z.output<typeof IdentityId> }) {
    super("LeaseLost");
    this.name = "LeaseLost";
    Object.assign(this, input);
  }
}
export class OutboxResolutionRejected extends Error {
  readonly _tag = "OutboxResolutionRejected";
  declare readonly id: z.output<typeof IdentityId>;
  declare readonly reason: "not_uncertain" | "conflict" | "identity_inactive";
  constructor(input: {
    readonly id: z.output<typeof IdentityId>;
    readonly reason: "not_uncertain" | "conflict" | "identity_inactive";
  }) {
    super("OutboxResolutionRejected");
    this.name = "OutboxResolutionRejected";
    Object.assign(this, input);
  }
}
export class MessagingStorageError extends Error {
  readonly _tag = "MessagingStorageError";
  constructor(input: { readonly message: string }) {
    super(input.message);
    this.name = "MessagingStorageError";
    Object.assign(this, input);
  }
}
export const decodeInput =
  <S extends z.ZodType>(schema: S) =>
  (input: unknown) =>
    schema.parseAsync(input);
export const invalidInput = () =>
  new InvalidMessage({
    message: "Invalid messaging input.",
  });

// The domain has a fixed set of object keys. Reconstructing those keys in this
// order canonicalizes JSON objects without changing meaningful array order.
export function canonicalPayload(payload: MessagePayload) {
  const normalized: MessagePayload = {
    inputRequest: payload.inputRequest
      ? {
          sessionId: payload.inputRequest.sessionId,
          requestId: payload.inputRequest.requestId,
          revision: payload.inputRequest.revision,
        }
      : undefined,
    sourceOccurredAtMs: payload.sourceOccurredAtMs,
    text: payload.text,
    attachments: (payload.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      mediaType: attachment.mediaType,
      name: attachment.name,
    })),
    replyToMessageId: payload.replyToMessageId,
    deliveryTargetId: payload.deliveryTargetId,
    conversationScope: payload.conversationScope,
  };
  return {
    payload: normalized,
    hash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
  };
}
export const decodeReceipt = async (
  ...args: Parameters<typeof MessageReceiptSchema.parseAsync>
) => {
  try {
    return await MessageReceiptSchema.parseAsync(...args);
  } catch {
    throw new MessagingStorageError({
      message: "Invalid messaging record.",
    });
  }
};

import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../operations/async";
import { ProviderInputError } from "./provider-errors";
import { ProviderUncertain } from "./provider-errors";
import { ProviderRetryable } from "./provider-errors";
import { ProviderRejected } from "./provider-errors";
import { ChannelAccountError } from "../accounts/errors";
import { z } from "zod";
import { env } from "@shared/environment/env";
import { channelProviderSchema } from "../../shared/identity/channel-auth";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { ChannelAccounts, IdentitySchema, type Identity } from "../accounts";
import {
  IdentityId,
  Messaging,
  MessagePayloadSchema,
  PayloadConflict,
  type MessageClaim,
} from "../messaging";
import { ProviderReferenceSchema } from "./inbound";
import { InputDeliveryReferenceSchema } from "../messaging/model";
import { Kapso, KapsoInstallationSchema } from "./kapso";
import { Telegram, TelegramInstallationSchema } from "./telegram";

/** Outbox drain terminal states — mutually exclusive; no bag of optional counters. */
type DrainOutboxResult =
  | {
      readonly state: "idle";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "sent";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "failed";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "deferred";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "uncertain";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "blocked";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    }
  | {
      readonly state: "limit";
      readonly sent: number;
      readonly failed: number;
      readonly uncertain: number;
    };
export class ChannelTransportError extends Error {
  readonly _tag = "ChannelTransportError";
  declare readonly reason:
    | "invalid_input"
    | "identity_inactive"
    | "channel_mismatch"
    | "installation_mismatch"
    | "configuration"
    | "unsupported_payload";
  constructor(input: {
    readonly reason:
      | "invalid_input"
      | "identity_inactive"
      | "channel_mismatch"
      | "installation_mismatch"
      | "configuration"
      | "unsupported_payload";
  }) {
    super("ChannelTransportError");
    this.name = "ChannelTransportError";
    Object.assign(this, input);
  }
}
function invalidInput(): never {
  throw new ChannelTransportError({
    reason: "invalid_input",
  });
}
const textSchema = z
  .string()
  .min(1)
  .max(16_384)
  .refine(
    (text) =>
      text.length <= 16_384 && text.isWellFormed() && text.trim().length > 0
  );
const enqueueInput = z.object({
  identityId: IdentityId,
  deliveryKey: z
    .string()
    .min(1)
    .max(254)
    .refine((value) => value === value.trim(), "Expected trimmed text"),
  text: textSchema,
  inputRequest: z.optional(InputDeliveryReferenceSchema),
  replyToMessageId: z.optional(ProviderReferenceSchema),
  deliveryTargetId: z.optional(ProviderReferenceSchema),
});
const candidateInput = z.object({
  channel: channelProviderSchema,
  limit: z.number().int().min(1).max(25),
});

/** Keeps UTF-16 surrogate pairs intact without changing the original text. */
export const splitChannelText = async function (text: string) {
  const value = await Promise.try(async () =>
    textSchema.parseAsync(text)
  ).catch(() => {
    return invalidInput();
  });
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(offset + 4000, value.length);
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(value.slice(offset, end));
    offset = end;
  }
  return chunks;
};
const accounts = ChannelAccounts;
const messaging = Messaging;
const telegram = Telegram;
const kapso = Kapso;
const identityColumns = sql`i.id, i.user_id AS "userId", i.channel,
    i.installation_id AS "installationId", i.sender_id AS "senderId"`;
const findIdentity = async function (identityId: string) {
  const id = await Promise.try(async () =>
    IdentityId.parseAsync(identityId)
  ).catch(() => {
    return invalidInput();
  });
  const rows = await query(
    sql`SELECT ${identityColumns} FROM channel_identity i WHERE i.id = ${id}`
  );
  if (!rows[0])
    throw new ChannelTransportError({
      reason: "identity_inactive",
    });
  return await IdentitySchema.parseAsync(rows[0]);
};
const activeIdentity = async function (
  identityId: string,
  expectedChannel: Identity["channel"]
) {
  const channel = await Promise.try(async () =>
    channelProviderSchema.parseAsync(expectedChannel)
  ).catch(() => {
    return invalidInput();
  });
  const identity = await findIdentity(identityId);
  if (identity.channel !== channel)
    throw new ChannelTransportError({
      reason: "channel_mismatch",
    });
  const active = await Promise.try(async () =>
    accounts.getActiveIdentity(identity)
  ).catch((error: unknown) => {
    if (error instanceof ChannelAccountError)
      return (() => {
        throw new ChannelTransportError({
          reason: "identity_inactive",
        });
      })();
    throw error;
  });
  if (active.id !== identity.id || active.userId !== identity.userId)
    throw new ChannelTransportError({
      reason: "identity_inactive",
    });
  const scope = accessScopeForUser(`better-auth:${active.userId}`);
  const membership = await query(sql`SELECT 1 FROM workspace_memberships
        WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}`);
  if (membership.length !== 1)
    throw new ChannelTransportError({
      reason: "identity_inactive",
    });
  return active;
};
const candidates = async function (
  lane: "inbox" | "outbox",
  channel: Identity["channel"],
  limit: number
) {
  const input = await Promise.try(async () =>
    candidateInput.parseAsync({
      channel,
      limit,
    })
  ).catch(() => {
    return invalidInput();
  });
  const table = sql.identifier(
    lane === "inbox" ? "channel_inbox" : "channel_outbox"
  );
  const receivedAt = lane === "inbox" ? sql`q.received_at` : sql`q.created_at`;
  const visibility = lane === "inbox" ? sql`i.revoked_at IS NULL` : sql`TRUE`;
  const cancelRevoked =
    lane === "outbox" ? sql`i.revoked_at IS NOT NULL` : sql`FALSE`;
  const recoverable =
    lane === "inbox"
      ? sql`q.status = 'uncertain' AND q.native_input IS NOT NULL`
      : sql`FALSE`;
  // Outbox may park a queued row until lease_expires_at after HTTP 429.
  const queuedReady =
    lane === "outbox"
      ? sql`q.status = 'queued' AND (q.lease_expires_at IS NULL OR q.lease_expires_at <= clock_timestamp())`
      : sql`q.status = 'queued'`;
  const rows = await query(sql`SELECT ${identityColumns}
      FROM channel_identity i
      JOIN LATERAL (
        SELECT min(${receivedAt}) AS oldest FROM ${table} q
        WHERE q.identity_id = i.id AND (
          (${recoverable})
          OR (q.status = 'dispatching' AND q.lease_expires_at <= clock_timestamp())
          OR ((${queuedReady}) AND (${cancelRevoked} OR NOT EXISTS (
            SELECT 1 FROM ${table} blocker WHERE blocker.identity_id = i.id AND (
              blocker.status = 'uncertain' OR
              (blocker.status = 'dispatching' AND blocker.lease_expires_at > clock_timestamp())
            )
          )))
        )
      ) eligible ON eligible.oldest IS NOT NULL
      WHERE i.channel = ${input.channel} AND ${visibility}
      ORDER BY eligible.oldest, i.id LIMIT ${input.limit}`);
  return await z.array(IdentitySchema).parseAsync(rows);
};
function installationMatches(identity: Identity) {
  let configured: string;
  try {
    configured =
      identity.channel === "telegram"
        ? TelegramInstallationSchema.parse({
            botId: env.TELEGRAM_BOT_ID,
            botUsername: env.TELEGRAM_BOT_USERNAME,
          }).botId
        : KapsoInstallationSchema.parse({
            phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
            phoneNumber: env.KAPSO_PHONE_NUMBER,
          }).phoneNumberId;
  } catch {
    throw new ChannelTransportError({
      reason: "configuration",
    });
  }
  if (configured !== identity.installationId)
    throw new ChannelTransportError({
      reason: "installation_mismatch",
    });
}
const dispatch = async function (claim: MessageClaim) {
  const lease = {
    id: claim.id,
    identityId: claim.identityId,
    leaseToken: claim.leaseToken,
  };
  const identity = await Promise.try(async () => {
    if (claim.payload.attachments?.length || !claim.payload.text)
      throw new ChannelTransportError({
        reason: "unsupported_payload",
      });
    const stored = await findIdentity(claim.identityId);
    const current = await activeIdentity(claim.identityId, stored.channel);
    installationMatches(current);
    return current;
  }).catch((error: unknown) => {
    if (error instanceof ChannelTransportError)
      return Promise.try(async () =>
        messaging.markOutboxFailed({
          lease,
          reason: "adapter_rejected",
        })
      ).then(() => Promise.reject(error));
    throw error;
  });
  await messaging.checkOutboxLease(lease);
  // No SQL transaction spans provider I/O. Only a confirmed receipt can mark sent.
  const send =
    identity.channel === "telegram"
      ? telegram.sendText.bind(telegram)
      : kapso.sendText.bind(kapso);
  const targetId =
    identity.channel === "telegram" && claim.payload.deliveryTargetId
      ? claim.payload.deliveryTargetId
      : identity.senderId;
  try {
    try {
      try {
        try {
          const receipt = await send(
            targetId,
            claim.payload.text ?? "",
            claim.payload.replyToMessageId
          );
          {
            await messaging.markSent({
              lease,
              receipt: {
                status: "sent",
                ...receipt,
              },
            });
            return "sent" as const;
          }
        } catch (error) {
          if (error instanceof ProviderRejected) {
            await messaging.markOutboxFailed({
              lease,
              reason: "adapter_rejected",
            });
            return "failed" as const;
          }
          throw error;
        }
      } catch (error) {
        if (error instanceof ProviderRetryable) {
          await messaging.scheduleOutboxRetry({
            lease,
            retryAfterSeconds: error.retryAfterSeconds,
          });
          return "deferred" as const;
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof ProviderUncertain) {
        await messaging.markOutboxUncertain({
          lease,
          reason: "handoff_unknown",
        });
        return "uncertain" as const;
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ProviderInputError) {
      await messaging.markOutboxFailed({
        lease,
        reason: "adapter_rejected",
      });
      throw new ChannelTransportError({
        reason:
          error.reason === "configuration" ? "configuration" : "invalid_input",
      });
    }
    throw error;
  }
};
const enqueueText = async function (input: z.output<typeof enqueueInput>) {
  const value = await Promise.try(async () =>
    enqueueInput.strict().parseAsync(input)
  ).catch(() => {
    return invalidInput();
  });
  const identity = await findIdentity(value.identityId);
  await activeIdentity(identity.id, identity.channel);
  const chunks = await splitChannelText(value.text);
  const payloads = await mapAsync(
    chunks,
    async (text) => {
      const payload: Record<string, z.core.util.JSONType> = {
        text,
      };
      if (value.inputRequest !== undefined)
        payload.inputRequest = {
          ...value.inputRequest,
        };
      if (value.replyToMessageId !== undefined)
        payload.replyToMessageId = value.replyToMessageId;
      if (value.deliveryTargetId !== undefined)
        payload.deliveryTargetId = value.deliveryTargetId;
      try {
        return await MessagePayloadSchema.parseAsync(payload);
      } catch {
        return invalidInput();
      }
    },
    1
  );
  return await withDatabaseTransaction(async () => {
    // Reserve the numeric suffix namespace under Messaging's identity lock.
    // At most five chunks are valid; a sixth existing key already proves conflict.
    await query(
      sql`SELECT id FROM channel_identity WHERE id = ${value.identityId} FOR UPDATE`
    );
    const prefix = `${value.deliveryKey}:`;
    const keys = payloads.map((_, index) => `${prefix}${String(index)}`);
    const existing = await query<{
      id: string;
      key: string;
    }>(sql`SELECT id, delivery_key AS key FROM channel_outbox
          WHERE identity_id = ${value.identityId}
            AND left(delivery_key, char_length(${prefix})) = ${prefix}
            AND substring(delivery_key FROM char_length(${prefix}) + 1) ~ '^[0-9]+$'
          LIMIT 6`);
    if (
      existing[0] &&
      (existing.length !== keys.length ||
        existing.some((row) => !keys.includes(row.key)))
    )
      throw new PayloadConflict({
        id: existing[0].id,
      });
    return await mapAsync(
      payloads,
      (payload, index) =>
        messaging.enqueue({
          identityId: value.identityId,
          deliveryKey: `${value.deliveryKey}:${String(index)}`,
          payload,
        }),
      1
    );
  });
};
const enqueueTaskReport = async function (
  input: z.output<typeof enqueueInput>
) {
  return await withDatabaseTransaction(async () => {
    const value = await Promise.try(async () =>
      enqueueInput.strict().parseAsync(input)
    ).catch(() => {
      return invalidInput();
    });
    await Promise.try(async () =>
      z
        .string()
        .regex(/^task-report:[0-9a-f]{64}$/u)
        .parseAsync(value.deliveryKey)
    ).catch(() => {
      return invalidInput();
    });
    await query(
      sql`SELECT id FROM channel_identity WHERE id = ${value.identityId} FOR UPDATE`
    );
    const identity = await findIdentity(value.identityId);
    await activeIdentity(identity.id, identity.channel);
    const prefix = `${value.deliveryKey}:`;
    const existing = await query<{
      key: string;
      payload: unknown;
    }>(sql`SELECT delivery_key AS key, payload FROM channel_outbox
        WHERE identity_id = ${value.identityId}
          AND left(delivery_key, char_length(${prefix})) = ${prefix}
        ORDER BY delivery_key LIMIT 6`);
    if (!existing.length) return await enqueueText(value);
    if (
      existing.length > 5 ||
      existing.some((row, index) => row.key !== `${prefix}${String(index)}`)
    )
      return invalidInput();
    return await mapAsync(
      existing,
      async (row) => {
        const payload = await Promise.try(async () =>
          MessagePayloadSchema.parseAsync(row.payload)
        ).catch(() => {
          return invalidInput();
        });
        return await messaging.enqueue({
          identityId: value.identityId,
          deliveryKey: row.key,
          payload,
        });
      },
      1
    );
  });
};
export const ChannelTransport = {
  activeIdentity,
  deliveredInput: async function (
    identityId: string,
    reference: z.output<typeof InputDeliveryReferenceSchema>
  ) {
    const id = await Promise.try(async () =>
      IdentityId.parseAsync(identityId)
    ).catch(() => {
      return invalidInput();
    });
    const value = await Promise.try(async () =>
      InputDeliveryReferenceSchema.parseAsync(reference)
    ).catch(() => {
      return invalidInput();
    });
    const prefix = `input:${value.sessionId}:${value.requestId}:`;
    const rows = await query(sql`SELECT delivery_key AS key, payload, status,
        (extract(epoch FROM sent_at) * 1000)::float8 AS "sentAtMs",
        provider_message_id AS "providerMessageId"
        FROM channel_outbox WHERE identity_id = ${id}
          AND left(delivery_key, char_length(${prefix})) = ${prefix}
          AND substring(delivery_key FROM char_length(${prefix}) + 1) ~ '^[0-9]+$'
        ORDER BY sequence LIMIT 6`);
    const chunks = await Promise.try(async () =>
      z
        .array(
          z.object({
            key: z.string(),
            payload: MessagePayloadSchema,
            status: z.string(),
            sentAtMs: z.nullable(z.number()),
            providerMessageId: z.nullable(z.string()),
          })
        )
        .parseAsync(rows)
    ).catch(() => {
      return invalidInput();
    });
    if (chunks.length === 0 || chunks.length > 5) return null;
    let deliveredAtMs = 0;
    const text: string[] = [];
    const providerMessageIds: string[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const delivered = chunk.payload.inputRequest;
      if (
        chunk.key !== `${prefix}${String(index)}` ||
        chunk.status !== "sent" ||
        chunk.sentAtMs === null ||
        !chunk.providerMessageId ||
        !chunk.payload.text ||
        delivered?.sessionId !== value.sessionId ||
        delivered.requestId !== value.requestId ||
        delivered.revision !== value.revision
      )
        return null;
      deliveredAtMs = Math.max(deliveredAtMs, chunk.sentAtMs);
      text.push(chunk.payload.text);
      providerMessageIds.push(chunk.providerMessageId);
    }
    const receiptId = providerMessageIds[0];
    if (!receiptId) return null;
    return {
      ...value,
      identityId: id,
      deliveredAtMs,
      text: text.join(""),
      receiptId,
      providerMessageIds,
    };
  },
  inboxCandidates: (channel: Identity["channel"], limit: number) =>
    candidates("inbox", channel, limit),
  outboxCandidates: (channel: Identity["channel"], limit: number) =>
    candidates("outbox", channel, limit),
  enqueueText,
  enqueueTaskReport,
  drainOutbox: async function (identityId: string) {
    const id = await Promise.try(async () =>
      IdentityId.parseAsync(identityId)
    ).catch(() => {
      return invalidInput();
    });
    let sent = 0;
    for (let index = 0; index < 8; index += 1) {
      const claim = await messaging.claimOutbox({
        identityId: id,
        leaseSeconds: 30,
      });
      if (!claim) {
        const remaining = await messaging.inspectOutbox(id);
        const uncertain =
          remaining.counts.find((count) => count.status === "uncertain")
            ?.count ?? 0;
        if (uncertain > 0)
          return {
            state: "uncertain",
            sent,
            failed: 0,
            uncertain,
          } satisfies DrainOutboxResult;
        const blocked = remaining.counts.some(
          (count) => count.status === "queued" || count.status === "dispatching"
        );
        if (blocked)
          return {
            state: "blocked",
            sent,
            failed: 0,
            uncertain: 0,
          } satisfies DrainOutboxResult;
        return {
          state: sent > 0 ? "sent" : "idle",
          sent,
          failed: 0,
          uncertain: 0,
        } satisfies DrainOutboxResult;
      }
      const state = await dispatch(claim);
      if (state !== "sent")
        return {
          state,
          sent,
          failed: state === "failed" ? 1 : 0,
          uncertain: state === "uncertain" ? 1 : 0,
        } satisfies DrainOutboxResult;
      sent += 1;
    }
    return {
      state: "limit",
      sent,
      failed: 0,
      uncertain: 0,
    } satisfies DrainOutboxResult;
  },
};

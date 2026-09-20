import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { ZodError as SchemaError } from "zod";

import { z } from "zod";

import { SqlError } from "@db/queries";
import {
  AcceptInputSchema,
  type AcceptInput,
  ClaimInputSchema,
  type ClaimInput,
  decodeInput,
  DeliveryFailureSchema,
  EnqueueInputSchema,
  type EnqueueInput,
  IdentityId,
  invalidInput,
  NativeInboxContentSchema,
  NativeInboxHandoffSchema,
  PrepareInboxHandoffSchema,
  PayloadConflict,
  LeaseSchema,
  type Lease,
  ResolveOutboxUncertainSchema,
  type ResolveOutboxUncertainInput,
} from "./model";
import { makeQueue, storageFailure } from "./store";
import { InputResponses } from "./input-response";

export * from "./model";

const adapterId = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), "Expected trimmed text");
const accepted = z.object({
  lease: LeaseSchema,
  receipt: z.object({
    status: z.literal("accepted"),
    sessionId: adapterId,
  }),
});
const sent = z.object({
  lease: LeaseSchema,
  receipt: z.object({
    status: z.literal("sent"),
    providerMessageId: adapterId,
  }),
});
const stopped = z.object({
  lease: LeaseSchema,
  reason: DeliveryFailureSchema,
});
const rejected = z.object({
  lease: LeaseSchema,
  reason: z.literal("adapter_rejected"),
});
const scheduleRetryInput = z.object({
  lease: LeaseSchema,
  retryAfterSeconds: z.number().int().min(1).max(3_600),
});

async function protect<A>(operation: Promise<A>): Promise<A> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof SqlError) throw storageFailure();
    if (error instanceof SchemaError) throw invalidInput();
    throw error;
  }
}

const inbox = makeQueue("inbox");
const outbox = makeQueue("outbox");
export const Messaging = {
  claimChannelInputResponse: (
    ...args: Parameters<typeof InputResponses.claim>
  ) => protect(InputResponses.claim(...args)),
  markChannelInputResponse: (...args: Parameters<typeof InputResponses.mark>) =>
    protect(InputResponses.mark(...args)),
  accept: async function (input: AcceptInput) {
    return await protect(
      (async () => {
        const value = await decodeInput(AcceptInputSchema)(input);
        return await inbox.insert({ ...value, key: value.eventId });
      })()
    );
  },
  enqueue: async function (input: EnqueueInput) {
    return await protect(
      (async () => {
        const value = await decodeInput(EnqueueInputSchema)(input);
        return await outbox.insert({
          ...value,
          key: value.deliveryKey,
          sourceMessageId: null,
        });
      })()
    );
  },
  claimInbox: async function (input: ClaimInput) {
    return await protect(
      (async () => {
        const value = await decodeInput(ClaimInputSchema)(input);
        return await inbox.claim(value.identityId, value.leaseSeconds);
      })()
    );
  },
  prepareInboxHandoff: async function (
    input: z.output<typeof PrepareInboxHandoffSchema>
  ) {
    return await protect(
      withDatabaseTransaction(async () => {
        const value = await decodeInput(PrepareInboxHandoffSchema)(input);
        const current = await inbox.checkLease(value.lease);
        const content = JSON.stringify(
          NativeInboxContentSchema.parse(value.content)
        );
        const rows =
          await query(sql`UPDATE channel_inbox SET native_input = jsonb_set(native_input, '{content}', ${content}::jsonb)
          WHERE id = ${value.lease.id} AND identity_id = ${value.lease.identityId}
            AND lease_token = ${value.lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
            AND (native_input->'content' = 'null'::jsonb OR native_input->'content' = ${content}::jsonb)
          RETURNING native_input AS input`);
        if (!rows[0]) {
          await inbox.checkLease(value.lease);
          throw new PayloadConflict({ id: value.lease.id });
        }
        // The first preparation commits its bounded, single-chunk transcript intents.
        // Identical replays do not recreate delivered or retained-away outbox entries.
        if (current.nativeInput?.content === null) {
          for (const [index, transcript] of value.transcripts.entries()) {
            await outbox.insert({
              identityId: value.lease.identityId,
              key: `transcript:${value.lease.id}:${String(index)}:0`,
              sourceMessageId: null,
              payload: {
                text: `I heard: ${transcript}\nIf this is incorrect, send a correction.`,
              },
            });
          }
        }
        return await z
          .object({
            ...NativeInboxHandoffSchema.shape,
            content: NativeInboxContentSchema,
          })
          .parseAsync(rows[0].input);
      })
    );
  },
  claimOutbox: async function (input: ClaimInput) {
    return await protect(
      (async () => {
        const value = await decodeInput(ClaimInputSchema)(input);
        return await outbox.claim(value.identityId, value.leaseSeconds);
      })()
    );
  },
  // Consumers must pass a confirmed adapter response, never a proposed ID.
  markAccepted: async function (input: z.output<typeof accepted>) {
    return await protect(
      (async () => {
        const value = await decodeInput(accepted)(input);
        return await inbox.complete(value.lease, value.receipt.sessionId);
      })()
    );
  },
  markSent: async function (input: z.output<typeof sent>) {
    return await protect(
      (async () => {
        const value = await decodeInput(sent)(input);
        return await outbox.complete(
          value.lease,
          value.receipt.providerMessageId
        );
      })()
    );
  },
  markInboxUncertain: async function (input: z.output<typeof stopped>) {
    return await protect(
      (async () => {
        const value = await decodeInput(stopped)(input);
        return await inbox.stop(value.lease, "uncertain", value.reason);
      })()
    );
  },
  markOutboxUncertain: async function (input: z.output<typeof stopped>) {
    return await protect(
      (async () => {
        const value = await decodeInput(stopped)(input);
        return await outbox.stop(value.lease, "uncertain", value.reason);
      })()
    );
  },
  // Failed is terminal and requires confirmed rejection/no external effect.
  // Timeouts and transport failures after dispatch belong in uncertain.
  markInboxFailed: async function (input: z.output<typeof rejected>) {
    return await protect(
      (async () => {
        const value = await decodeInput(rejected)(input);
        return await inbox.stop(value.lease, "failed", value.reason);
      })()
    );
  },
  markOutboxFailed: async function (input: z.output<typeof rejected>) {
    return await protect(
      (async () => {
        const value = await decodeInput(rejected)(input);
        return await outbox.stop(value.lease, "failed", value.reason);
      })()
    );
  },
  // Explicit audited reconciliation for uncertain outbox. A lost receipt must
  // not block an identity forever; authorize_retry accepts duplicate-send risk.
  resolveOutboxUncertain: async function (input: ResolveOutboxUncertainInput) {
    return await protect(
      (async () => {
        const value = await decodeInput(ResolveOutboxUncertainSchema)(input);
        return await outbox.resolveUncertain(value);
      })()
    );
  },
  // Rate-limited sends are definite rejections; re-queue after the provider delay.
  scheduleOutboxRetry: async function (
    input: z.output<typeof scheduleRetryInput>
  ) {
    return await protect(
      (async () => {
        const value = await decodeInput(scheduleRetryInput)(input);
        return await outbox.scheduleRetry(value.lease, value.retryAfterSeconds);
      })()
    );
  },
  checkInboxLease: async function (input: Lease) {
    return await protect(
      (async () => {
        return await inbox.checkLease(await decodeInput(LeaseSchema)(input));
      })()
    );
  },
  checkOutboxLease: async function (input: Lease) {
    return await protect(
      (async () => {
        return await outbox.checkLease(await decodeInput(LeaseSchema)(input));
      })()
    );
  },
  inspectInbox: async function (identityId: string) {
    return await protect(
      (async () => {
        return await inbox.inspect(await decodeInput(IdentityId)(identityId));
      })()
    );
  },
  inspectOutbox: async function (identityId: string) {
    return await protect(
      (async () => {
        return await outbox.inspect(await decodeInput(IdentityId)(identityId));
      })()
    );
  },
};

import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { resolvedInstallationSecrets } from "@db/services/installation-secrets";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import {
  ChannelAccountError,
  ChannelAccounts,
  PreviewChallenge,
  VerifiedSender,
} from "../accounts/index.ts";
const Id = z.uuid({
  version: "v4",
});
const Identifier = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "Expected trimmed text");
const Status = z.enum([
  "queued",
  "dispatching",
  "sent",
  "uncertain",
  "failed",
  "cancelled",
]);
const PreparePrompt = z.object({
  ...PreviewChallenge.shape,
  eventId: Identifier,
});
const PromptLease = z.object({
  challengeId: Id,
  leaseToken: Id,
});
const PromptReceipt = z.object({
  challengeId: Id,
  status: Status,
});
const Envelope = z.object({
  challengeId: Id,
  ...PreparePrompt.shape,
});
const EnvelopeJson = jsonString(Envelope);
const PromptRow = z.object({
  ...PromptReceipt.shape,
  ...VerifiedSender.shape,
  eventId: Identifier,
  tokenCiphertext: z.nullable(z.string()),
});
export class ChannelAuthPromptError extends Error {
  readonly _tag = "ChannelAuthPromptError";
  declare readonly reason:
    | "invalid_input"
    | "conflict"
    | "lease_lost"
    | "crypto_unavailable";
  constructor(input: {
    readonly reason:
      | "invalid_input"
      | "conflict"
      | "lease_lost"
      | "crypto_unavailable";
  }) {
    super("ChannelAuthPromptError");
    this.name = "ChannelAuthPromptError";
    Object.assign(this, input);
  }
}
function error(reason: ChannelAuthPromptError["reason"]): never {
  throw new ChannelAuthPromptError({
    reason,
  });
}
const decode = async <S extends z.ZodType>(schema: S, input: z.output<S>) => {
  try {
    return await schema.parseAsync(input);
  } catch {
    return error("invalid_input");
  }
};
/** A single encrypted confirmation prompt per challenge. No provider I/O or polling. */

const accounts = ChannelAccounts;
const encryptionKey = async () => {
  try {
    const key = (await resolvedInstallationSecrets()).betterAuthSecret;
    await z.string().min(32).parseAsync(key.reveal());
    return key;
  } catch {
    return error("crypto_unavailable");
  }
};
const transaction = <A>(operation: () => Promise<A>) =>
  withDatabaseTransaction(async () => {
    // Shared with account mutations, so proof validation and queue transitions agree.
    await query(sql`SELECT pg_advisory_xact_lock(724193, 1)`);
    return await operation();
  });
const retire = async () => {
  await query(sql`UPDATE public.channel_auth_prompt SET status = 'uncertain', token_ciphertext = NULL,
        lease_token = NULL, lease_expires_at = NULL, last_error = 'lease_expired'
        WHERE status = 'dispatching' AND lease_expires_at <= clock_timestamp()`);
  await query(sql`UPDATE public.channel_auth_prompt p SET status = 'cancelled', token_ciphertext = NULL,
        lease_token = NULL, lease_expires_at = NULL, last_error = 'challenge_inactive'
        FROM public.channel_auth_challenge c WHERE c.id = p.challenge_id
        AND p.status = 'queued'
        AND (c.expires_at <= clock_timestamp() OR c.cancelled_at IS NOT NULL OR c.confirmed_at IS NOT NULL OR c.consumed_at IS NOT NULL)`);
};
const select = async function (challengeId: string) {
  const rows = await query<
    z.output<typeof PromptRow>
  >(sql`SELECT challenge_id AS "challengeId", channel,
        installation_id AS "installationId", sender_id AS "senderId", event_id AS "eventId",
        token_ciphertext AS "tokenCiphertext", status FROM public.channel_auth_prompt WHERE challenge_id = ${challengeId}`);
  return rows[0];
};
const cancel = async function (
  challengeId: string,
  status: "cancelled" | "failed"
) {
  await query(sql`UPDATE public.channel_auth_prompt SET status = ${status}, token_ciphertext = NULL,
        lease_token = NULL, lease_expires_at = NULL, last_error = ${status === "failed" ? "invalid_envelope" : "challenge_inactive"}
        WHERE challenge_id = ${challengeId} AND status = 'queued'`);
};
const preview = async (input: z.output<typeof PreviewChallenge>) => {
  try {
    return await accounts.previewChallenge(input);
  } catch (cause) {
    if (cause instanceof ChannelAccountError) return null;
    throw cause;
  }
};
const decrypt = async function (row: z.output<typeof PromptRow>) {
  const ciphertext = row.tokenCiphertext;
  if (!ciphertext) return null;
  const key = await encryptionKey();
  const plaintext = await symmetricDecrypt({
    key: key.reveal(),
    data: ciphertext,
  }).catch(() => null);
  if (plaintext === null) return null;
  const envelope = await Promise.try(async () =>
    EnvelopeJson.parseAsync(plaintext)
  ).catch(() => Promise.resolve(null));
  if (
    !envelope ||
    envelope.challengeId !== row.challengeId ||
    envelope.eventId !== row.eventId ||
    envelope.sender.channel !== row.channel ||
    envelope.sender.installationId !== row.installationId ||
    envelope.sender.senderId !== row.senderId
  )
    return null;
  return envelope;
};
const prepare = async function (input: z.output<typeof PreparePrompt>) {
  const request = await decode(PreparePrompt, input);
  return await transaction(async () => {
    await retire();
    const challenges = await query<{
      id: string;
    }>(sql`SELECT id FROM public.channel_auth_challenge
          WHERE token_hash = ${createHash("sha256").update(request.token).digest("hex")}
          AND channel = ${request.sender.channel} AND installation_id = ${request.sender.installationId}`);
    const challenge = challenges[0];
    if (!challenge)
      throw new ChannelAccountError({
        reason: "invalid_challenge",
      });
    const events = await query<{
      challengeId: string;
    }>(sql`SELECT challenge_id AS "challengeId" FROM public.channel_auth_prompt
          WHERE channel = ${request.sender.channel} AND installation_id = ${request.sender.installationId} AND event_id = ${request.eventId}`);
    if (events.some((event) => event.challengeId !== challenge.id))
      return error("conflict");
    const existing = await select(challenge.id);
    if (existing) {
      if (
        existing.senderId !== request.sender.senderId ||
        existing.channel !== request.sender.channel ||
        existing.installationId !== request.sender.installationId
      )
        return error("conflict");
      if (existing.status === "queued") {
        const valid = await preview(request);
        if (!valid) {
          await cancel(challenge.id, "cancelled");
          return {
            challengeId: challenge.id,
            status: "cancelled" as const,
          };
        }
      }
      return {
        challengeId: challenge.id,
        status: existing.status,
      };
    }
    await accounts.previewChallenge(request);
    const key = await encryptionKey();
    const encoded = await Promise.try(async () =>
      Promise.resolve(
        JSON.stringify(
          Envelope.parse({
            ...request,
            challengeId: challenge.id,
          })
        )
      )
    ).catch(() => {
      return error("invalid_input");
    });
    const ciphertext = await Promise.try(async () =>
      symmetricEncrypt({
        key: key.reveal(),
        data: encoded,
      })
    ).catch(() => {
      return error("crypto_unavailable");
    });
    await query(sql`INSERT INTO public.channel_auth_prompt
          (challenge_id, channel, installation_id, sender_id, event_id, token_ciphertext)
          VALUES (${challenge.id}, ${request.sender.channel}, ${request.sender.installationId}, ${request.sender.senderId}, ${request.eventId}, ${ciphertext})`);
    return {
      challengeId: challenge.id,
      status: "queued" as const,
    };
  });
};
const pending = async function (limit?: number) {
  const size = await decode(z.number().int().min(1).max(100), limit ?? 100);
  return await transaction(async () => {
    await retire();
    const rows = await query<{
      challengeId: string;
    }>(sql`SELECT challenge_id AS "challengeId" FROM public.channel_auth_prompt
          WHERE status = 'queued' ORDER BY created_at, challenge_id LIMIT ${size}`);
    return rows.map((row) => row.challengeId);
  });
};
const claim = async function (challengeId: string) {
  const id = await decode(Id, challengeId);
  return await transaction(async () => {
    await retire();
    const row = await select(id);
    if (row?.status !== "queued") return null;
    const envelope = await decrypt(row);
    if (!envelope) {
      await cancel(id, "failed");
      return null;
    }
    const challenge = await preview(envelope);
    if (!challenge) {
      await cancel(id, "cancelled");
      return null;
    }
    const leaseToken = randomUUID();
    await query(sql`UPDATE public.channel_auth_prompt SET status = 'dispatching', attempts = attempts + 1,
          lease_token = ${leaseToken}, lease_expires_at = clock_timestamp() + interval '30 seconds'
          WHERE challenge_id = ${id} AND status = 'queued'`);
    return {
      lease: {
        challengeId: id,
        leaseToken,
      },
      ...envelope.sender,
      token: envelope.token,
      purpose: challenge.purpose,
    };
  });
};
const checkLease = async function (input: z.output<typeof PromptLease>) {
  const lease = await decode(PromptLease, input);
  const valid = await transaction(async () => {
    await retire();
    const matches =
      await query(sql`SELECT challenge_id FROM public.channel_auth_prompt
          WHERE challenge_id = ${lease.challengeId} AND lease_token = ${lease.leaseToken}
          AND status = 'dispatching' AND lease_expires_at > clock_timestamp()`);
    if (!matches.length) return false;
    const row = await select(lease.challengeId);
    if (!row) return false;
    const envelope = await decrypt(row);
    // A failed recheck prevents new I/O, but must not erase a receipt
    // from I/O that already began under this lease.
    if (!envelope || !(await preview(envelope))) return false;
    await retire();
    const active = await query<{
      valid: boolean;
    }>(sql`SELECT EXISTS (
              SELECT 1 FROM public.channel_auth_prompt p JOIN public.channel_auth_challenge c ON c.id = p.challenge_id
              WHERE p.challenge_id = ${lease.challengeId} AND p.lease_token = ${lease.leaseToken}
              AND p.status = 'dispatching' AND p.lease_expires_at > clock_timestamp()
              AND c.expires_at > clock_timestamp() AND c.confirmed_at IS NULL
              AND c.cancelled_at IS NULL AND c.consumed_at IS NULL) AS valid`);
    return active[0]?.valid === true;
  });
  if (!valid) return error("lease_lost");
  return undefined;
};
const settle = async function (
  input: z.output<typeof PromptLease>,
  status: "sent" | "uncertain" | "failed",
  providerMessageId: string | null
) {
  const lease = await decode(PromptLease, input);
  const changed = await transaction(async () => {
    await retire();
    return await query(sql`UPDATE public.channel_auth_prompt SET status = ${status}, token_ciphertext = NULL,
          lease_token = NULL, lease_expires_at = NULL, provider_message_id = ${providerMessageId},
          sent_at = CASE WHEN ${status} = 'sent' THEN clock_timestamp() ELSE NULL END,
          last_error = CASE WHEN ${status} = 'sent' THEN NULL ELSE ${status === "failed" ? "delivery_rejected" : "delivery_uncertain"} END
          WHERE challenge_id = ${lease.challengeId} AND lease_token = ${lease.leaseToken}
          AND status = 'dispatching' AND lease_expires_at > clock_timestamp() RETURNING challenge_id`);
  });
  if (!changed.length) return error("lease_lost");
  return undefined;
};
const markSent = async function (
  lease: z.output<typeof PromptLease>,
  providerMessageId: string
) {
  const id = await decode(Identifier, providerMessageId);
  await settle(lease, "sent", id);
};
export const ChannelAuthPrompts = {
  prepare,
  pending,
  claim,
  checkLease,
  markSent,
  markUncertain: (lease: z.output<typeof PromptLease>) =>
    settle(lease, "uncertain", null),
  markRejected: (lease: z.output<typeof PromptLease>) =>
    settle(lease, "failed", null),
};

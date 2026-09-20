import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../operations/async";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";

import {
  canonicalPayload,
  decodeReceipt,
  IdentityInactive,
  LeaseLost,
  MessagingStorageError,
  MessageClaimSchema,
  OutboxResolutionRejected,
  PayloadConflict,
  type DeliveryFailure,
  type Lease,
  type MessagePayload,
  type OutboxResolutionDecision,
  type ResolveOutboxUncertainInput,
} from "./model";

const queues = {
  inbox: {
    table: "channel_inbox",
    key: "event_id",
    hash: "event_hash",
    order: "sequence",
    result: "session_id",
    completedAt: "accepted_at",
    completed: "accepted",
  },
  outbox: {
    table: "channel_outbox",
    key: "delivery_key",
    hash: "intent_hash",
    order: "sequence",
    result: "provider_message_id",
    completedAt: "sent_at",
    completed: "sent",
  },
} as const;
export type Lane = keyof typeof queues;

const lockActive = async function (identityId: string) {
  const rows = await query<{
    active: boolean;
  }>(sql`SELECT revoked_at IS NULL AS active
      FROM channel_identity WHERE id = ${identityId} FOR UPDATE`);
  if (!rows[0]?.active) throw new IdentityInactive({ identityId });
  return undefined;
};

export const makeQueue = (lane: Lane) => {
  const queue = queues[lane];
  const table = sql.identifier(queue.table);
  const sourceMessageId =
    lane === "inbox" ? sql`source_message_id` : sql`NULL::text`;
  const nativeInput = lane === "inbox" ? sql`native_input` : sql`NULL::jsonb`;
  const columns = sql`id, identity_id AS "identityId", ${sql.identifier(queue.key)} AS key,
    ${sourceMessageId} AS "sourceMessageId", payload, ${nativeInput} AS "nativeInput", status, attempts, lease_token AS "leaseToken",
    lease_expires_at::text AS "leaseExpiresAt", ${sql.identifier(queue.result)} AS "resultId",
    last_error AS "lastError"`;

  const insert = async function (input: {
    identityId: string;
    key: string;
    sourceMessageId: string | null;
    payload: MessagePayload;
  }) {
    return await withDatabaseTransaction(async () => {
      await lockActive(input.identityId);
      const canonical = canonicalPayload(input.payload);
      const hash =
        lane === "inbox"
          ? createHash("sha256")
              .update(JSON.stringify([input.sourceMessageId, canonical.hash]))
              .digest("hex")
          : canonical.hash;
      const identityScope =
        lane === "inbox"
          ? sql`identity_id IN (SELECT previous.id FROM channel_identity previous
          JOIN channel_identity current ON current.channel = previous.channel
            AND current.installation_id = previous.installation_id AND current.sender_id = previous.sender_id
          WHERE current.id = ${input.identityId})`
          : sql`identity_id = ${input.identityId}`;
      const existing = await query<{ id: string; hash: string }>(sql`
      SELECT id, ${sql.identifier(queue.hash)} AS hash FROM ${table}
      WHERE ${identityScope} AND ${sql.identifier(queue.key)} = ${input.key}`);
      const previous = existing[0];
      if (previous) {
        if (previous.hash !== hash) {
          throw new PayloadConflict({ id: previous.id });
        }
        const rows = await query(
          sql`SELECT ${columns} FROM ${table} WHERE id = ${previous.id}`
        );
        return await decodeReceipt(rows[0]);
      }
      const sourceColumn = lane === "inbox" ? sql`, source_message_id` : sql``;
      const sourceValue =
        lane === "inbox" ? sql`, ${input.sourceMessageId}` : sql``;
      const rows = await query(sql`INSERT INTO ${table}
      (id, identity_id, ${sql.identifier(queue.key)}, ${sql.identifier(queue.hash)}, payload, status${sourceColumn})
      VALUES (${randomUUID()}, ${input.identityId}, ${input.key}, ${hash},
        ${sql`${JSON.stringify(canonical.payload)}::jsonb`}, 'queued'${sourceValue}) RETURNING ${columns}`);
      return await decodeReceipt(rows[0]);
    });
  };

  const claim = async function (identityId: string, leaseSeconds: number) {
    return await withDatabaseTransaction(async () => {
      const identities = await query<{
        active: boolean;
        channel: string;
        principalId: string;
      }>(sql`SELECT revoked_at IS NULL AS active, channel, 'better-auth:' || user_id AS "principalId"
      FROM channel_identity WHERE id = ${identityId} FOR UPDATE SKIP LOCKED`);
      if (!identities[0]) return null;
      await query(sql`UPDATE ${table} SET status = 'uncertain', last_error = 'lease_expired',
      lease_token = NULL, lease_expires_at = NULL
      WHERE identity_id = ${identityId} AND status = 'dispatching'
        AND lease_expires_at <= clock_timestamp()`);
      if (!identities[0].active) {
        if (lane === "outbox") {
          await query(sql`UPDATE ${table} SET status = 'cancelled', last_error = 'identity_revoked'
          WHERE identity_id = ${identityId} AND status = 'queued'`);
        }
        return null;
      }
      const recoverable =
        lane === "inbox" ? sql`native_input IS NOT NULL` : sql`FALSE`;
      const blocked =
        await query(sql`SELECT id FROM ${table} WHERE identity_id = ${identityId}
      AND (status = 'dispatching' OR (status = 'uncertain' AND NOT (${recoverable}))) LIMIT 1`);
      if (blocked.length > 0) return null;
      const snapshot =
        lane === "inbox"
          ? sql`, native_input = COALESCE(native_input, jsonb_build_object(
          'protocol', 'eve-keyed-input-v1', 'inputId', id::text,
          'channel', ${identities[0].channel}::text, 'address', COALESCE(payload->>'conversationScope', identity_id::text),
          'principalId', ${identities[0].principalId}::text, 'content', NULL))`
          : sql``;
      // lease_expires_at on queued rows is a not-before time for rate-limit deferral.
      const rows =
        await query(sql`UPDATE ${table} SET status = 'dispatching'${snapshot},
        attempts = attempts + 1, lease_token = ${randomUUID()},
        lease_expires_at = clock_timestamp() + ${leaseSeconds} * interval '1 second'
      WHERE id = (SELECT id FROM ${table} WHERE identity_id = ${identityId}
        AND (status = 'queued' OR (status = 'uncertain' AND (${recoverable})))
        ORDER BY ${sql.identifier(queue.order)}, id
        LIMIT 1 FOR UPDATE SKIP LOCKED)
        AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
      RETURNING ${columns}`);
      return rows[0] ? await MessageClaimSchema.parseAsync(rows[0]) : null;
    });
  };

  const requireLease = async function (lease: Lease) {
    await lockActive(lease.identityId);
    const rows = await query(sql`SELECT ${columns} FROM ${table}
      WHERE id = ${lease.id} AND identity_id = ${lease.identityId}
        AND status = 'dispatching' AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp() FOR UPDATE`);
    if (!rows[0]) throw new LeaseLost({ id: lease.id });
    return await decodeReceipt(rows[0]);
  };

  const complete = async function (lease: Lease, resultId: string) {
    return await withDatabaseTransaction(async () => {
      await requireLease(lease);
      const rows =
        await query(sql`UPDATE ${table} SET status = ${queue.completed},
      ${sql.identifier(queue.result)} = ${resultId}, ${sql.identifier(queue.completedAt)} = clock_timestamp(),
      lease_token = NULL, lease_expires_at = NULL, last_error = NULL
      WHERE id = ${lease.id} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp() RETURNING ${columns}`);
      if (!rows[0]) throw new LeaseLost({ id: lease.id });
      return await decodeReceipt(rows[0]);
    });
  };

  const stop = async function (
    lease: Lease,
    status: "uncertain" | "failed",
    reason: DeliveryFailure
  ) {
    return await withDatabaseTransaction(async () => {
      await requireLease(lease);
      const rows =
        await query(sql`UPDATE ${table} SET status = ${status}, last_error = ${reason},
      lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${lease.id} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp() RETURNING ${columns}`);
      if (!rows[0]) throw new LeaseLost({ id: lease.id });
      return await decodeReceipt(rows[0]);
    });
  };

  const resolveUncertain = async function (input: ResolveOutboxUncertainInput) {
    return await withDatabaseTransaction(async () => {
      if (lane !== "outbox") {
        throw new OutboxResolutionRejected({
          id: input.id,
          reason: "not_uncertain",
        });
      }
      const decision: OutboxResolutionDecision = input.decision;
      // Cancel may clear a revoked identity's stuck uncertain row; delivery/retry
      // still require an active identity because they assert or risk an effect.
      if (decision.kind !== "cancel") {
        await lockActive(input.identityId);
      } else {
        const rows = await query<{
          active: boolean;
        }>(sql`SELECT revoked_at IS NULL AS active
        FROM channel_identity WHERE id = ${input.identityId} FOR UPDATE`);
        if (!rows[0]) {
          throw new OutboxResolutionRejected({
            id: input.id,
            reason: "identity_inactive",
          });
        }
      }

      const current = await query<{
        id: string;
        status: string;
        lastError: string | null;
        resultId: string | null;
      }>(sql`SELECT id, status, last_error AS "lastError",
        provider_message_id AS "resultId"
      FROM ${table}
      WHERE id = ${input.id} AND identity_id = ${input.identityId}
      FOR UPDATE`);
      const row = current[0];
      if (!row) {
        throw new OutboxResolutionRejected({
          id: input.id,
          reason: "not_uncertain",
        });
      }

      const detail =
        decision.kind === "mark_delivered"
          ? decision.providerMessageId
          : decision.kind === "cancel"
            ? decision.reason
            : decision.acknowledgment;

      if (row.status !== "uncertain") {
        if (
          decision.kind === "mark_delivered" &&
          row.status === "sent" &&
          row.resultId === decision.providerMessageId
        ) {
          const existing = await query(
            sql`SELECT ${columns} FROM ${table} WHERE id = ${input.id}`
          );
          return await decodeReceipt(existing[0]);
        }
        if (
          decision.kind === "cancel" &&
          row.status === "cancelled" &&
          row.lastError === decision.reason
        ) {
          const existing = await query(
            sql`SELECT ${columns} FROM ${table} WHERE id = ${input.id}`
          );
          return await decodeReceipt(existing[0]);
        }
        if (
          decision.kind === "authorize_retry" &&
          row.status === "queued" &&
          row.lastError === "duplicate_retry_authorized"
        ) {
          const existing = await query(
            sql`SELECT ${columns} FROM ${table} WHERE id = ${input.id}`
          );
          return await decodeReceipt(existing[0]);
        }
        throw new OutboxResolutionRejected({
          id: input.id,
          reason: "not_uncertain",
        });
      }

      await query(sql`INSERT INTO channel_outbox_resolution
      (id, outbox_id, identity_id, decision, detail, prior_status, prior_error,
       actor_principal_id, note)
      VALUES (
        ${randomUUID()},
        ${input.id},
        ${input.identityId},
        ${decision.kind},
        ${detail},
        'uncertain',
        ${row.lastError},
        ${input.actorPrincipalId},
        ${input.note ?? null}
      )`);

      if (decision.kind === "mark_delivered") {
        const rows = await query(sql`UPDATE ${table} SET status = 'sent',
        provider_message_id = ${decision.providerMessageId},
        sent_at = clock_timestamp(),
        lease_token = NULL, lease_expires_at = NULL, last_error = NULL
        WHERE id = ${input.id} AND status = 'uncertain'
        RETURNING ${columns}`);
        if (!rows[0]) {
          throw new OutboxResolutionRejected({
            id: input.id,
            reason: "conflict",
          });
        }
        return await decodeReceipt(rows[0]);
      }

      if (decision.kind === "cancel") {
        const rows = await query(sql`UPDATE ${table} SET status = 'cancelled',
        last_error = ${decision.reason},
        lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${input.id} AND status = 'uncertain'
        RETURNING ${columns}`);
        if (!rows[0]) {
          throw new OutboxResolutionRejected({
            id: input.id,
            reason: "conflict",
          });
        }
        return await decodeReceipt(rows[0]);
      }

      const rows = await query(sql`UPDATE ${table} SET status = 'queued',
      last_error = 'duplicate_retry_authorized',
      lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${input.id} AND status = 'uncertain'
      RETURNING ${columns}`);
      if (!rows[0]) {
        throw new OutboxResolutionRejected({
          id: input.id,
          reason: "conflict",
        });
      }
      return await decodeReceipt(rows[0]);
    });
  };

  const scheduleRetry = async function (
    lease: Lease,
    retryAfterSeconds: number
  ) {
    return await withDatabaseTransaction(async () => {
      await requireLease(lease);
      const seconds = Math.min(
        Math.max(Math.floor(retryAfterSeconds), 1),
        3_600
      );
      const rows =
        await query(sql`UPDATE ${table} SET status = 'queued', last_error = 'adapter_rate_limited',
      lease_token = NULL,
      lease_expires_at = clock_timestamp() + ${seconds} * interval '1 second'
      WHERE id = ${lease.id} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp() RETURNING ${columns}`);
      if (!rows[0]) throw new LeaseLost({ id: lease.id });
      return await decodeReceipt(rows[0]);
    });
  };

  const inspect = async function (identityId: string) {
    const counts =
      await query(sql`SELECT status, count(*)::int AS count FROM ${table}
      WHERE identity_id = ${identityId} GROUP BY status ORDER BY status`);
    const pending = await query(sql`SELECT ${columns} FROM ${table}
      WHERE identity_id = ${identityId} AND status = 'uncertain'
      ORDER BY ${sql.identifier(queue.order)}, id LIMIT 100`);
    const decodedCounts = await z
      .array(z.object({ status: z.string(), count: z.number().int() }))
      .parseAsync(counts);
    return {
      counts: decodedCounts,
      uncertain: await mapAsync(pending, (row) => decodeReceipt(row), 1),
    };
  };

  return {
    insert,
    claim,
    complete,
    stop,
    resolveUncertain,
    scheduleRetry,
    inspect,
    checkLease: (lease: Lease) =>
      withDatabaseTransaction(async () => requireLease(lease)),
  };
};

export const storageFailure = () =>
  new MessagingStorageError({ message: "Messaging storage operation failed." });

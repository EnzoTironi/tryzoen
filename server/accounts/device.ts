import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../operations/async";
import { z } from "zod";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import {
  deviceBindingSchema,
  channelChallengeRequestSchema,
} from "../../shared/identity/channel-auth";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { resolvedInstallationSecrets } from "@db/services/installation-secrets";
import { ChannelAccountError, ChannelAccounts } from "./index";
import { requireArchivableAccount } from "./archive-transfer";
const Identifier = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "Expected trimmed text");
const Id = z.uuid();
const BrowserSecret = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const Source = z.object({
  identityId: Id,
  sessionId: Identifier,
});
const Purpose = channelChallengeRequestSchema.shape.purpose;
const BrowserSession = z.object({
  userId: Identifier,
  sessionId: Identifier,
});
const Issue = z.object({
  ...Source.shape,
  callId: Identifier,
  purpose: Purpose,
});
const Resume = z.object({
  id: Id,
  purpose: Purpose,
  browserSecret: BrowserSecret,
  link: z.optional(BrowserSession),
});
const Bind = z.object({
  ...deviceBindingSchema.shape,
  browserSecret: BrowserSecret,
  link: z.optional(BrowserSession),
});
const Selection = z.object({
  ...Source.shape,
  challengeId: Id,
  purpose: Purpose,
  browserBoundAt: Identifier,
  archivePreviousAccount: deviceBindingSchema.shape.archivePreviousAccount,
});
const Device = z.object({
  id: Id,
  purpose: Purpose,
  channel: z.enum(["telegram", "kapso"]),
  expiresAt: z.string(),
  browserBoundAt: z.nullable(z.string()),
  confirmedAt: z.nullable(z.string()),
  archivePreviousAccount: z.boolean(),
});
function invalid(): never {
  throw new ChannelAccountError({
    reason: "invalid_challenge",
  });
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const decode = async <S extends z.ZodRawShape>(
  schema: z.ZodObject<S>,
  input: z.output<z.ZodObject<S>>
) => {
  try {
    return await schema.strict().parseAsync(input);
  } catch {
    return invalid();
  }
};

/** Native initiation and browser binding on the existing account challenge. */

const accounts = ChannelAccounts;
const transaction = <A>(operation: () => Promise<A>) =>
  withDatabaseTransaction(async () => {
    // Same account lifecycle lock as ChannelAccounts; no provider I/O under it.
    await query(sql`SELECT pg_advisory_xact_lock(724193, 1)`);
    return await operation();
  });
const identity = async function (id: string) {
  const rows = await query<{
    channel: "telegram" | "kapso";
    installationId: string;
    senderId: string;
  }>(sql`SELECT channel, installation_id AS "installationId", sender_id AS "senderId"
        FROM public.channel_identity WHERE id = ${id} AND revoked_at IS NULL`);
  if (!rows[0]) return invalid();
  return await accounts.getActiveIdentity(rows[0]);
};
const sourceIdentity = async function (source: z.output<typeof Source>) {
  const owner = await identity(source.identityId);
  const principalId = `better-auth:${owner.userId}`;
  const rows = await query(sql`SELECT s.session_id FROM agent_sessions s
        JOIN workspace_memberships m ON m.workspace_id = s.workspace_id AND m.user_id = s.created_by_user_id
        WHERE s.session_id = ${source.sessionId} AND s.created_by_user_id = ${principalId}
        AND s.workspace_id = ${accessScopeForUser(principalId).workspaceId}`);
  if (!rows.length) return invalid();
  return owner;
};
const requireBoundSession = async function (
  id: string,
  userId: string,
  browser?: z.output<typeof BrowserSession>
) {
  const rows = await query<
    z.output<typeof BrowserSession>
  >(sql`SELECT target_user_id AS "userId", requesting_session_id AS "sessionId"
          FROM public.channel_auth_challenge WHERE id = ${id} AND purpose = 'link'
          AND (target_user_id = ${userId} OR source_user_id = ${userId}) AND requesting_session_id IS NOT NULL`);
  const session = rows[0];
  if (
    !session ||
    (browser &&
      (browser.sessionId !== session.sessionId ||
        browser.userId !== session.userId))
  )
    throw new ChannelAccountError({
      reason: "session_invalid",
    });
  await accounts.requireFreshSession(session);
};
const select = async function (id: string) {
  const rows = await query<
    z.output<typeof Device>
  >(sql`SELECT id, purpose, channel,
        to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
        to_char(browser_bound_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "browserBoundAt",
        to_char(confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "confirmedAt",
        source_user_id IS NOT NULL AS "archivePreviousAccount"
        FROM public.channel_auth_challenge WHERE id = ${id} AND intended_identity_id IS NOT NULL
        AND expires_at > clock_timestamp() AND cancelled_at IS NULL AND consumed_at IS NULL`);
  if (!rows[0]) return invalid();
  return rows[0];
};
const issue = async function (input: z.output<typeof Issue>) {
  const request = await decode(Issue, input);
  const key = (await resolvedInstallationSecrets()).betterAuthSecret;
  if (key.reveal().length < 32) return invalid();
  return await transaction(async () => {
    const owner = await sourceIdentity(request);
    const existing = await query<{
      id: string;
    }>(sql`SELECT id FROM public.channel_auth_challenge
          WHERE intended_identity_id = ${owner.id} AND source_session_id = ${request.sessionId}
          AND source_call_id = ${request.callId}`);
    const id = existing[0]?.id ?? randomUUID();
    // Reproducible only for this random challenge ID; retries need no plaintext token storage.
    const token = createHmac("sha256", key.reveal())
      .update(`companion-device-entry:${id}`)
      .digest("base64url");
    if (!existing.length) {
      await query(sql`INSERT INTO public.channel_auth_challenge
            (id, purpose, token_hash, intended_identity_id, entry_token_hash, source_session_id,
             source_call_id, channel, installation_id, expires_at, created_at)
            VALUES (${id}, ${request.purpose}, ${hash(token)}, ${owner.id}, ${hash(token)}, ${request.sessionId},
              ${request.callId}, ${owner.channel}, ${owner.installationId}, clock_timestamp() + interval '5 minutes', clock_timestamp())`);
    }
    const challenge = await select(id);
    if (challenge.purpose !== request.purpose) return invalid();
    return {
      challenge,
      entryToken: challenge.browserBoundAt ? null : token,
    };
  });
};
const bind = async function (input: z.output<typeof Bind>) {
  const request = await decode(Bind, input);
  return await transaction(async () => {
    const rows = await query<{
      identityId: string;
      sessionId: string;
      purpose: z.output<typeof Purpose>;
      targetUserId: string | null;
      requestingSessionId: string | null;
      browserSecretHash: string | null;
      entryTokenHash: string | null;
    }>(sql`SELECT intended_identity_id AS "identityId", source_session_id AS "sessionId",
          purpose, target_user_id AS "targetUserId", requesting_session_id AS "requestingSessionId",
          browser_secret_hash AS "browserSecretHash", entry_token_hash AS "entryTokenHash"
          FROM public.channel_auth_challenge WHERE id = ${request.id} AND intended_identity_id IS NOT NULL
          AND confirmed_at IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL
          AND expires_at > clock_timestamp() FOR UPDATE`);
    const row = rows[0];
    if (!row || row.purpose !== request.purpose) return invalid();
    const owner = await sourceIdentity(row);
    if (row.purpose === "link") {
      if (!request.link)
        throw new ChannelAccountError({
          reason: "session_invalid",
        });
      await accounts.requireFreshSession(request.link);
      if (owner.userId !== request.link.userId) {
        if (!request.archivePreviousAccount)
          throw new ChannelAccountError({
            reason: "account_conflict",
          });
        await requireArchivableAccount(owner.userId, request.link.userId);
      } else if (request.archivePreviousAccount) return invalid();
      if (
        row.requestingSessionId !== null &&
        row.requestingSessionId !== request.link.sessionId
      )
        throw new ChannelAccountError({
          reason: "session_invalid",
        });
    } else if (request.link || request.archivePreviousAccount) return invalid();
    if (row.browserSecretHash !== null) {
      if (row.browserSecretHash !== hash(request.browserSecret))
        return invalid();
      return await select(request.id);
    }
    if (row.entryTokenHash !== hash(request.token)) return invalid();
    await query(sql`UPDATE public.channel_auth_challenge SET browser_secret_hash = ${hash(request.browserSecret)},
          browser_bound_at = clock_timestamp(), entry_token_hash = NULL,
          target_user_id = ${request.link?.userId ?? null}, requesting_session_id = ${request.link?.sessionId ?? null}
          , source_user_id = ${request.archivePreviousAccount ? owner.userId : null}
          WHERE id = ${request.id}`);
    return await select(request.id);
  });
};
const resume = async function (input: z.output<typeof Resume>) {
  const request = await decode(Resume, input);
  return await transaction(async () => {
    const rows = await query<{
      identityId: string;
      sessionId: string;
    }>(sql`SELECT intended_identity_id AS "identityId", source_session_id AS "sessionId"
            FROM public.channel_auth_challenge WHERE id = ${request.id}
            AND intended_identity_id IS NOT NULL AND browser_secret_hash = ${hash(request.browserSecret)}`);
    if (!rows[0]) return invalid();
    const owner = await sourceIdentity(rows[0]);
    const device = await select(request.id);
    if (device.purpose !== request.purpose) return invalid();
    if (device.purpose === "link") {
      if (!request.link)
        throw new ChannelAccountError({
          reason: "session_invalid",
        });
      await requireBoundSession(request.id, owner.userId, request.link);
    } else if (request.link) return invalid();
    return device;
  });
};
const pending = async function (input: z.output<typeof Source>) {
  const request = await decode(Source, input);
  return await transaction(async () => {
    await sourceIdentity(request);
    const rows = await query<{
      id: string;
    }>(sql`SELECT id FROM public.channel_auth_challenge
          WHERE intended_identity_id = ${request.identityId} AND source_session_id = ${request.sessionId}
          AND browser_bound_at IS NOT NULL AND confirmed_at IS NULL AND consumed_at IS NULL
          AND cancelled_at IS NULL AND expires_at > clock_timestamp() ORDER BY browser_bound_at DESC LIMIT 10`);
    return await mapAsync(rows, (row) => select(row.id), 1);
  });
};
const confirm = async function (input: z.output<typeof Selection>) {
  const request = await decode(Selection, input);
  return await transaction(async () => {
    const owner = await sourceIdentity(request);
    const device = await select(request.challengeId);
    if (device.purpose !== request.purpose) return invalid();
    if (
      (request.archivePreviousAccount === true) !==
      device.archivePreviousAccount
    )
      return invalid();
    if (device.purpose === "link")
      await requireBoundSession(request.challengeId, owner.userId);
    const rows = await query(sql`UPDATE public.channel_auth_challenge
          SET confirmed_at = COALESCE(confirmed_at, clock_timestamp()), confirmed_sender_id = ${owner.senderId}
          WHERE id = ${request.challengeId} AND purpose = ${request.purpose} AND intended_identity_id = ${owner.id}
          AND source_session_id = ${request.sessionId} AND browser_bound_at IS NOT NULL
          AND to_char(browser_bound_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = ${request.browserBoundAt}
          AND browser_secret_hash IS NOT NULL AND entry_token_hash IS NULL
          AND cancelled_at IS NULL AND consumed_at IS NULL AND expires_at > clock_timestamp()
          RETURNING id`);
    if (!rows.length) return invalid();
    return {
      confirmed: true as const,
    };
  });
};
export const NativeDeviceAuth = {
  issue,
  bind,
  resume,
  pending,
  confirm,
};

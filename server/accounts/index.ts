import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  channelProviderSchema,
  type channelChallengeStatusSchema,
} from "../../shared/identity/channel-auth.ts";
import { accessScopeForUser } from "../../shared/identity/access-scope.ts";
import { ChannelAccountError } from "./errors";
import { archiveChannelAccount } from "./archive-transfer";
export { ChannelAccountError } from "./errors";
const Identifier = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "Expected trimmed text");
const Uuid = z.uuid();
const Secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const VerifiedSender = z.object({
  channel: channelProviderSchema,
  installationId: Identifier,
  senderId: Identifier,
});
const IssueChallenge = z.union([
  z.object({
    purpose: z.literal("login"),
    channel: channelProviderSchema,
    installationId: Identifier,
    browserSecret: Secret,
  }),
  z.object({
    purpose: z.literal("link"),
    channel: channelProviderSchema,
    installationId: Identifier,
    browserSecret: Secret,
    userId: Identifier,
    sessionId: Identifier,
  }),
]);
const ConfirmChallenge = z.object({
  token: Secret,
  sender: VerifiedSender,
});
const ChallengeStatus = z.object({
  challengeId: Uuid,
  browserSecret: Secret,
});
const ConsumeChallenge = z.object({
  challengeId: Uuid,
  browserSecret: Secret,
  currentSessionId: z.optional(Identifier),
});
const FreshSession = z.object({
  userId: Identifier,
  sessionId: Identifier,
});
const RevokeIdentity = z.object({
  identityId: Uuid,
  userId: Identifier,
});
export const IdentitySchema = z.object({
  id: Uuid,
  userId: Identifier,
  ...VerifiedSender.shape,
});
export type Identity = z.output<typeof IdentitySchema>;
const UnlinkedContact = z.object({
  prompt: z.boolean(),
});
const IdentityRow = z.object({
  ...IdentitySchema.shape,
  revoked: z.boolean(),
});
const ChallengeRow = z.object({
  id: Uuid,
  purpose: z.enum(["login", "link"]),
  channel: channelProviderSchema,
  installationId: Identifier,
  targetUserId: z.nullable(Identifier),
  sourceUserId: z.nullable(Identifier),
  requestingSessionId: z.nullable(Identifier),
  identityId: z.nullable(Uuid),
  confirmedSenderId: z.nullable(Identifier),
});
export const PreviewChallenge = ConfirmChallenge;
const ChallengePreview = z.object({
  id: Uuid,
  purpose: ChallengeRow.shape.purpose,
  expiresAt: z.string(),
});
const SessionOwner = z.object({
  identityId: IdentitySchema.shape.id,
  userId: IdentitySchema.shape.userId,
});
const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
function fail(reason: ChannelAccountError["reason"]): never {
  throw new ChannelAccountError({
    reason,
  });
}
const decode = async <S extends z.ZodType>(schema: S, input: z.output<S>) => {
  try {
    return await schema.parseAsync(input);
  } catch {
    return fail("invalid_input");
  }
};
const publicIdentity = ({
  id,
  userId,
  channel,
  installationId,
  senderId,
}: Identity): Identity => ({
  id,
  userId,
  channel,
  installationId,
  senderId,
});

/**
 * Transport verification and explicit channel confirmation belong to the caller.
 * Google sign-in creates the user; a messenger only becomes usable through a
 * consumed link challenge. First contact never creates a user or a workspace.
 */

const transaction = <A>(effect: () => Promise<A>) =>
  withDatabaseTransaction(async () => {
    await query(sql`SELECT pg_advisory_xact_lock(724193, 1)`);
    return await effect();
  });
const findIdentity = async function (sender: z.output<typeof VerifiedSender>) {
  const rows = await query<
    z.output<typeof IdentityRow>
  >(sql`SELECT id, user_id AS "userId", channel,
        installation_id AS "installationId", sender_id AS "senderId", revoked_at IS NOT NULL AS revoked
        FROM public.channel_identity WHERE channel = ${sender.channel}
        AND installation_id = ${sender.installationId} AND sender_id = ${sender.senderId}
        ORDER BY revoked_at NULLS FIRST, created_at DESC LIMIT 1`);
  return rows[0];
};
const requireSession = async function (
  userId: string,
  sessionId: string,
  requireFresh = false
) {
  const rows = await query(sql`SELECT s.id FROM public.session s
        JOIN workspace_memberships m ON m.user_id = ${`better-auth:${userId}`} AND m.workspace_id = ${accessScopeForUser(`better-auth:${userId}`).workspaceId}
        WHERE s.id = ${sessionId} AND s."userId" = ${userId} AND s."expiresAt" > clock_timestamp()
        AND (NOT ${requireFresh} OR (s."createdAt" >= clock_timestamp() - interval '10 minutes' AND s."createdAt" <= clock_timestamp())) FOR UPDATE OF s`);
  if (!rows.length) return fail("session_invalid");
  return undefined;
};
const requireFreshSession = async function (
  input: z.output<typeof FreshSession>
) {
  const request = await decode(FreshSession, input);
  await transaction(async () =>
    requireSession(request.userId, request.sessionId, true)
  );
};
const linkIdentity = async function (
  sender: z.output<typeof VerifiedSender>,
  userId: string
) {
  const existing = await findIdentity(sender);
  if (existing?.revoked) return fail("identity_inactive");
  if (existing) {
    if (existing.userId !== userId) return fail("account_conflict");
    return publicIdentity(existing);
  }
  const id = randomUUID();
  await query(sql`INSERT INTO public.channel_identity
        (id, channel, installation_id, sender_id, user_id, verified_at, created_at, updated_at)
        VALUES (${id}, ${sender.channel}, ${sender.installationId}, ${sender.senderId}, ${userId},
          clock_timestamp(), clock_timestamp(), clock_timestamp())`);
  await query(sql`DELETE FROM public.channel_pending_sender WHERE channel = ${sender.channel}
        AND installation_id = ${sender.installationId} AND sender_id = ${sender.senderId}`);
  return {
    id,
    userId,
    ...sender,
  };
};
const requireLinkedIdentity = async function (
  sender: z.output<typeof VerifiedSender>
) {
  const existing = await findIdentity(sender);
  if (!existing) return fail("sender_unlinked");
  if (existing.revoked) return fail("identity_inactive");
  return publicIdentity(existing);
};
const resolveVerifiedSender = async function (
  input: z.output<typeof VerifiedSender>
) {
  const sender = await decode(VerifiedSender, input);
  const existing = await findIdentity(sender);
  if (existing?.revoked) return fail("identity_inactive");
  if (existing)
    return {
      status: "linked" as const,
      identity: publicIdentity(existing),
    };
  return {
    status: "unlinked" as const,
    sender,
  };
};
const recordUnlinkedContact = async function (
  input: z.output<typeof VerifiedSender>
) {
  const sender = await decode(VerifiedSender, input);
  return await transaction(async () => {
    // now() is transaction-stable, so the RETURNING comparison is exact.
    const rows = await query<z.output<typeof UnlinkedContact>>(sql`
              INSERT INTO public.channel_pending_sender
                (channel, installation_id, sender_id, first_seen_at, last_seen_at, contact_count, prompted_at)
              SELECT ${sender.channel}, ${sender.installationId}, ${sender.senderId}, now(), now(), 1, now()
              WHERE NOT EXISTS (SELECT 1 FROM public.channel_identity WHERE channel = ${sender.channel}
                AND installation_id = ${sender.installationId} AND sender_id = ${sender.senderId})
              ON CONFLICT (channel, installation_id, sender_id) DO UPDATE SET
                last_seen_at = now(),
                contact_count = public.channel_pending_sender.contact_count + 1,
                prompted_at = CASE WHEN public.channel_pending_sender.prompted_at IS NULL
                  OR public.channel_pending_sender.prompted_at <= now() - interval '24 hours' THEN now()
                  ELSE public.channel_pending_sender.prompted_at END
              RETURNING (prompted_at = now()) AS prompt`);
    const contact = rows[0];
    if (!contact)
      return {
        prompt: false,
      };
    return await decode(UnlinkedContact, contact);
  });
};
const getActiveIdentity = async function (
  input: z.output<typeof VerifiedSender>
) {
  const sender = await decode(VerifiedSender, input);
  const identity = await findIdentity(sender);
  if (!identity || identity.revoked) return fail("identity_inactive");
  return publicIdentity(identity);
};
const issueChallenge = async function (input: z.output<typeof IssueChallenge>) {
  const request = await decode(IssueChallenge, input);
  return await transaction(async () => {
    if (request.purpose === "link")
      await requireSession(request.userId, request.sessionId, true);
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const targetUserId = request.purpose === "link" ? request.userId : null;
    const requestingSessionId =
      request.purpose === "link" ? request.sessionId : null;
    const issued = await query<{
      expiresAt: string;
    }>(sql`INSERT INTO public.channel_auth_challenge
          (id, purpose, token_hash, browser_secret_hash, target_user_id, requesting_session_id,
           channel, installation_id, expires_at, created_at)
          VALUES (${id}, ${request.purpose}, ${hash(token)}, ${hash(request.browserSecret)},
            ${targetUserId}, ${requestingSessionId}, ${request.channel},
            ${request.installationId}, clock_timestamp() + interval '5 minutes', clock_timestamp())
          RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt"`);
    const expiry = issued[0];
    if (!expiry) return fail("invalid_challenge");
    return {
      challengeId: id,
      token,
      expiresAt: expiry.expiresAt,
    };
  });
};
const previewChallenge = async function (
  input: z.output<typeof PreviewChallenge>
) {
  const request = await decode(PreviewChallenge, input);
  return await transaction(async () => {
    const rows = await query<
      z.output<typeof ChallengePreview> &
        Pick<
          z.output<typeof ChallengeRow>,
          "targetUserId" | "requestingSessionId"
        >
    >(sql`
              SELECT id, purpose, target_user_id AS "targetUserId", requesting_session_id AS "requestingSessionId",
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt"
              FROM public.channel_auth_challenge
              WHERE token_hash = ${hash(request.token)} AND channel = ${request.sender.channel}
              AND installation_id = ${request.sender.installationId}
              AND intended_identity_id IS NULL
              AND confirmed_at IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL
              AND expires_at > clock_timestamp()`);
    const preview = rows[0];
    if (!preview) return fail("invalid_challenge");
    const existing = await findIdentity(request.sender);
    if (existing?.revoked) return fail("identity_inactive");
    if (preview.purpose === "login" && !existing)
      return fail("sender_unlinked");
    if (preview.purpose === "link") {
      if (!preview.targetUserId || !preview.requestingSessionId)
        return fail("invalid_challenge");
      await requireSession(
        preview.targetUserId,
        preview.requestingSessionId,
        true
      );
      if (existing && existing.userId !== preview.targetUserId)
        return fail("account_conflict");
    }
    return {
      id: preview.id,
      purpose: preview.purpose,
      expiresAt: preview.expiresAt,
    };
  });
};
const confirmChallenge = async function (
  input: z.output<typeof ConfirmChallenge>
) {
  const request = await decode(ConfirmChallenge, input);
  return await transaction(async () => {
    const rows = await query<
      z.output<typeof ChallengeRow>
    >(sql`SELECT id, purpose, channel, installation_id AS "installationId",
          target_user_id AS "targetUserId", source_user_id AS "sourceUserId", requesting_session_id AS "requestingSessionId", identity_id AS "identityId", confirmed_sender_id AS "confirmedSenderId"
          FROM public.channel_auth_challenge WHERE token_hash = ${hash(request.token)}
          AND intended_identity_id IS NULL
          AND consumed_at IS NULL AND cancelled_at IS NULL
          AND expires_at > clock_timestamp() FOR UPDATE`);
    const challenge = rows[0];
    if (
      !challenge ||
      challenge.channel !== request.sender.channel ||
      challenge.installationId !== request.sender.installationId
    )
      return fail("invalid_challenge");
    if (challenge.confirmedSenderId) {
      if (challenge.confirmedSenderId !== request.sender.senderId)
        return fail("invalid_challenge");
      return {
        challengeId: challenge.id,
      };
    }
    const prompts = await query<{
      senderId: string;
    }>(sql`
                SELECT sender_id AS "senderId" FROM public.channel_auth_prompt
                WHERE challenge_id = ${challenge.id}`);
    if (prompts[0] && prompts[0].senderId !== request.sender.senderId)
      return fail("invalid_challenge");
    if (challenge.purpose === "link") {
      if (!challenge.targetUserId || !challenge.requestingSessionId)
        return fail("invalid_challenge");
      await requireSession(
        challenge.targetUserId,
        challenge.requestingSessionId
      );
    }
    const existing = await findIdentity(request.sender);
    if (existing?.revoked) return fail("identity_inactive");
    if (
      existing &&
      challenge.targetUserId &&
      existing.userId !== challenge.targetUserId
    )
      return fail("account_conflict");
    if (challenge.purpose === "login" && !existing)
      return fail("sender_unlinked");
    await query(sql`UPDATE public.channel_auth_challenge
                SET confirmed_sender_id = ${request.sender.senderId}, confirmed_at = clock_timestamp()
                WHERE id = ${challenge.id}`);
    return {
      challengeId: challenge.id,
    };
  });
};
const getChallengeStatus = async function (
  input: z.output<typeof ChallengeStatus>
) {
  const request = await decode(ChallengeStatus, input);
  const rows = await query<z.output<typeof channelChallengeStatusSchema>>(sql`
            SELECT CASE
              WHEN consumed_at IS NOT NULL THEN 'consumed'
              WHEN cancelled_at IS NOT NULL OR expires_at <= clock_timestamp() THEN 'expired'
              WHEN confirmed_at IS NOT NULL THEN 'confirmed'
              ELSE 'pending'
            END AS status
            FROM public.channel_auth_challenge
            WHERE id = ${request.challengeId} AND browser_secret_hash = ${hash(request.browserSecret)}`);
  const result = rows[0];
  if (!result) return fail("invalid_challenge");
  return result;
};
const consumeChallenge = async function (
  input: z.output<typeof ConsumeChallenge>
) {
  const request = await decode(ConsumeChallenge, input);
  return await transaction(async () => {
    const rows = await query<
      z.output<typeof ChallengeRow>
    >(sql`SELECT id, purpose, channel, installation_id AS "installationId",
          target_user_id AS "targetUserId", source_user_id AS "sourceUserId", requesting_session_id AS "requestingSessionId", identity_id AS "identityId", confirmed_sender_id AS "confirmedSenderId"
          FROM public.channel_auth_challenge WHERE id = ${request.challengeId}
          AND browser_secret_hash = ${hash(request.browserSecret)} AND confirmed_at IS NOT NULL
          AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE`);
    const challenge = rows[0];
    if (!challenge?.confirmedSenderId) return fail("invalid_challenge");
    const sender = {
      channel: challenge.channel,
      installationId: challenge.installationId,
      senderId: challenge.confirmedSenderId,
    };
    const identity = await (async function () {
      switch (challenge.purpose) {
        case "link": {
          if (
            !challenge.targetUserId ||
            !challenge.requestingSessionId ||
            challenge.requestingSessionId !== request.currentSessionId
          )
            return fail("session_invalid");
          await requireSession(
            challenge.targetUserId,
            challenge.requestingSessionId,
            true
          );
          if (challenge.sourceUserId)
            await archiveChannelAccount({
              sourceUserId: challenge.sourceUserId,
              targetUserId: challenge.targetUserId,
              challengeId: challenge.id,
              sender,
            });
          return await linkIdentity(sender, challenge.targetUserId);
        }
        case "login":
          return await requireLinkedIdentity(sender);
        default: {
          const purpose: never = challenge.purpose;
          return purpose;
        }
      }
    })();
    await query(sql`UPDATE public.channel_auth_challenge SET identity_id = CASE WHEN source_user_id IS NULL THEN ${identity.id} ELSE intended_identity_id END,
                consumed_at = clock_timestamp() WHERE id = ${challenge.id}`);
    const principalId = `better-auth:${identity.userId}`;
    const scope = accessScopeForUser(principalId);
    return {
      userId: identity.userId,
      identityId: identity.id,
      purpose: challenge.purpose,
      principalId,
      workspaceId: scope.workspaceId,
    };
  });
};
const withLoginSession = async function <A>(
  owner: z.output<typeof SessionOwner>,
  createSession: () => Promise<A>
) {
  const request = await decode(SessionOwner, owner);
  return await transaction(async () => {
    const rows = await query(sql`SELECT id FROM public.channel_identity
              WHERE id = ${request.identityId} AND user_id = ${request.userId} AND revoked_at IS NULL`);
    if (!rows.length) return fail("identity_inactive");
    return await createSession();
  });
};
const revokeIdentity = async function (input: z.output<typeof RevokeIdentity>) {
  const request = await decode(RevokeIdentity, input);
  await transaction(async () => {
    const identities =
      await query(sql`SELECT id FROM public.channel_identity WHERE id = ${request.identityId}
          AND user_id = ${request.userId} AND revoked_at IS NULL FOR UPDATE`);
    if (!identities.length) return fail("identity_inactive");
    const remaining =
      await query(sql`SELECT id FROM public.channel_identity WHERE user_id = ${request.userId}
          AND id <> ${request.identityId} AND revoked_at IS NULL`);
    if (!remaining.length) return fail("last_access");
    await query(sql`UPDATE public.channel_identity SET revoked_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = ${request.identityId}`);
    await query(sql`UPDATE public.channel_auth_challenge SET cancelled_at = clock_timestamp()
          WHERE consumed_at IS NULL AND cancelled_at IS NULL
          AND (identity_id = ${request.identityId} OR intended_identity_id = ${request.identityId} OR target_user_id = ${request.userId}
            OR requesting_session_id IN (SELECT id FROM public.session WHERE "userId" = ${request.userId})
            OR EXISTS (SELECT 1 FROM public.channel_identity i WHERE i.id = ${request.identityId}
              AND i.channel = public.channel_auth_challenge.channel
              AND i.installation_id = public.channel_auth_challenge.installation_id
              AND i.sender_id = public.channel_auth_challenge.confirmed_sender_id))`);
    await query(
      sql`DELETE FROM public.session WHERE "userId" = ${request.userId}`
    );
    return undefined;
  });
};
export const ChannelAccounts = {
  requireFreshSession,
  resolveVerifiedSender,
  recordUnlinkedContact,
  getActiveIdentity,
  issueChallenge,
  confirmChallenge,
  previewChallenge,
  consumeChallenge,
  withLoginSession,
  getChallengeStatus,
  revokeIdentity,
};

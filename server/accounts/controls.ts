import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { ChannelAccountError } from "./errors";
import { ZodError as SchemaError } from "zod";
import { SqlError } from "../../db/queries";
import { AuthUnavailable } from "../../db/services/auth/index";
import { z } from "zod";
import { readAuthSession } from "@db/services/auth/session";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { ChannelAccounts, IdentitySchema } from "./index";
export class AccountControlError extends Error {
  readonly _tag = "AccountControlError";
  declare readonly reason:
    | "unauthenticated"
    | "identity_inactive"
    | "unavailable";
  constructor(input: {
    readonly reason: "unauthenticated" | "identity_inactive" | "unavailable";
  }) {
    super("AccountControlError");
    this.name = "AccountControlError";
    Object.assign(this, input);
  }
}
const linkedIdentitySchema = z.object({
  id: IdentitySchema.shape.id,
  channel: IdentitySchema.shape.channel,
  senderId: IdentitySchema.shape.senderId,
});
export const requireControlSession = async function (headers: Headers) {
  const session = await readAuthSession(headers);
  if (!session)
    throw new AccountControlError({
      reason: "unauthenticated",
    });
  const scope = accessScopeForUser(`better-auth:${session.user.id}`);
  const rows = await query(sql`
    SELECT s.id FROM public.session s
    INNER JOIN workspace_memberships m ON m.user_id = ${scope.userId} AND m.workspace_id = ${scope.workspaceId}
    WHERE s.id = ${session.session.id} AND s."userId" = ${session.user.id} AND s."expiresAt" > clock_timestamp()`);
  if (rows.length !== 1)
    throw new AccountControlError({
      reason: "unauthenticated",
    });
  return session;
};
export const readLinkedChannelIdentities = async function (headers: Headers) {
  try {
    const session = await requireControlSession(headers);
    const rows = await query(
      sql`SELECT id, channel, sender_id AS "senderId" FROM public.channel_identity WHERE user_id = ${session.user.id} AND revoked_at IS NULL ORDER BY channel, created_at, id`
    );
    return await z.array(linkedIdentitySchema).parseAsync(rows);
  } catch (error) {
    if (
      error instanceof AuthUnavailable ||
      error instanceof SqlError ||
      error instanceof SchemaError
    ) {
      throw new AccountControlError({
        reason: "unavailable",
      });
    }
    throw error;
  }
};
export const revokeLinkedChannelIdentity = async function (
  headers: Headers,
  identityId: string
) {
  try {
    const id = await Promise.try(async () =>
      IdentitySchema.shape.id.parseAsync(identityId)
    ).catch(() => {
      throw new AccountControlError({
        reason: "identity_inactive",
      });
    });
    const session = await requireControlSession(headers);
    const accounts = ChannelAccounts;
    try {
      await accounts.revokeIdentity({
        identityId: id,
        userId: session.user.id,
      });
      return {
        status: "revoked" as const,
      };
    } catch (error) {
      if (error instanceof ChannelAccountError) {
        if (error.reason === "last_access")
          return { status: "last_access" as const };
        throw new AccountControlError({
          reason:
            error.reason === "identity_inactive"
              ? "identity_inactive"
              : error.reason === "session_invalid"
                ? "unauthenticated"
                : "unavailable",
        });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof AuthUnavailable || error instanceof SqlError) {
      throw new AccountControlError({
        reason: "unavailable",
      });
    }
    throw error;
  }
};

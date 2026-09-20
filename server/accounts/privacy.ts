import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { SqlError } from "../../db/queries";

import { readAuthSession } from "@db/services/auth/session";
import { accessScopeForUser } from "@shared/identity/access-scope";
import {
  accountOnlineWipeLimits,
  accountOnlineWipeNotWiped,
  accountPrivacyExportExcluded,
  accountPrivacyExportLimits,
} from "@shared/identity/account-privacy-limits";
import { PersonalMemory } from "../personal-memory";
import {
  PersonalMemoryError,
  requirePersonalMemoryWebSession,
} from "../personal-memory/access";

import { inspectPersonalMemory } from "../personal-memory/export";

/**
 * Account privacy export/delete gates.
 *
 * Fail closed without a live Better Auth session + canonical membership.
 * Export and delete cover stored personal memory only — not a full-account
 * backup, restore contract, or complete erasure (see README).
 */
export class AccountPrivacyError extends Error {
  readonly _tag = "AccountPrivacyError";
  declare readonly reason: "unauthenticated" | "unavailable";
  constructor(input: { readonly reason: "unauthenticated" | "unavailable" }) {
    super("AccountPrivacyError");
    this.name = "AccountPrivacyError";
    Object.assign(this, input);
  }
}

const requirePrivacySession = async function (headers: Headers) {
  const session = await readAuthSession(headers);
  if (!session) throw new AccountPrivacyError({ reason: "unauthenticated" });
  const scope = accessScopeForUser(`better-auth:${session.user.id}`);
  await Promise.try(async () =>
    requirePersonalMemoryWebSession(scope, session.session.id)
  ).catch((error: unknown) => {
    throw !(error instanceof PersonalMemoryError) ||
      error.reason === "unavailable"
      ? new AccountPrivacyError({ reason: "unavailable" })
      : new AccountPrivacyError({ reason: "unauthenticated" });
  });
  return { session, scope };
};

export const exportAccountPrivacy = async function (headers: Headers) {
  const snapshot = await Promise.try(async () =>
    inspectPersonalMemory(headers)
  ).catch((error: unknown) => {
    throw !(error instanceof PersonalMemoryError) ||
      error.reason === "unavailable"
      ? new AccountPrivacyError({ reason: "unavailable" })
      : new AccountPrivacyError({ reason: "unauthenticated" });
  });
  return {
    scope: "account-privacy-export" as const,
    generatedAt: snapshot.generatedAt,
    personalMemory: snapshot,
    coverage: {
      included: snapshot.coverage.included,
      excluded: accountPrivacyExportExcluded,
      limits: accountPrivacyExportLimits,
    },
  };
};

export const deleteAccountOnlineData = async function (headers: Headers) {
  try {
    const { session, scope } = await requirePrivacySession(headers);
    const memory = PersonalMemory;
    const wiped = await Promise.try(async () => memory.wipe(scope)).catch(
      (error: unknown) => {
        throw !(error instanceof PersonalMemoryError) ||
          error.reason === "unavailable"
          ? new AccountPrivacyError({ reason: "unavailable" })
          : new AccountPrivacyError({ reason: "unauthenticated" });
      }
    );

    await query(
      sql`DELETE FROM public.session WHERE "userId" = ${session.user.id}`
    );
    // Re-check membership after wipe; session rows are already gone.
    const membership =
      await query(sql`SELECT workspace_id FROM workspace_memberships
      WHERE user_id = ${scope.userId} AND workspace_id = ${scope.workspaceId}`);
    if (membership.length !== 1)
      throw new AccountPrivacyError({ reason: "unauthenticated" });
    return {
      status: "partial_online_wipe" as const,
      wiped: wiped.wiped,
      notWiped: accountOnlineWipeNotWiped,
      limits: accountOnlineWipeLimits,
    };
  } catch (error) {
    if (error instanceof SqlError) {
      throw new AccountPrivacyError({ reason: "unavailable" });
    }
    throw error;
  }
};

export const exportAccountPrivacyResponse = async function (headers: Headers) {
  const body = await exportAccountPrivacy(headers);
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition":
        'attachment; filename="companion-account-privacy.json"',
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
};

export const deleteAccountOnlineDataResponse = async function (
  headers: Headers
) {
  const body = await deleteAccountOnlineData(headers);
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
};

export function accountPrivacyErrorResponse(error: AccountPrivacyError) {
  return new Response(
    error.reason === "unauthenticated"
      ? "Sign in to manage account privacy."
      : "Account privacy is unavailable. Try again.",
    {
      status: error.reason === "unauthenticated" ? 401 : 503,
      headers: { "cache-control": "private, no-store" },
    }
  );
}

import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { SqlError } from "../../db/queries";

import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";

export class PersonalMemoryError extends Error {
  readonly _tag = "PersonalMemoryError";
  declare readonly reason:
    | "unauthenticated"
    | "invalid_binding"
    | "unavailable"
    | "cross_scope";
  constructor(input: {
    readonly reason:
      | "unauthenticated"
      | "invalid_binding"
      | "unavailable"
      | "cross_scope";
  }) {
    super("PersonalMemoryError");
    this.name = "PersonalMemoryError";
    Object.assign(this, input);
  }
}

export const requirePersonalMemoryMembership = async function (
  scope: AccessScope
) {
  const canonical = accessScopeForUser(scope.userId);
  if (canonical.workspaceId !== scope.workspaceId)
    throw new PersonalMemoryError({ reason: "unauthenticated" });

  const rows = await query(sql`SELECT workspace_id FROM workspace_memberships
    WHERE user_id = ${scope.userId} AND workspace_id = ${scope.workspaceId} FOR SHARE`);
  if (rows.length !== 1)
    throw new PersonalMemoryError({ reason: "unauthenticated" });
  return scope;
};

export const requirePersonalMemoryWebSession = async function (
  scope: AccessScope,
  sessionId: string
) {
  try {
    await requirePersonalMemoryMembership(scope);

    const rows = await query(sql`SELECT id FROM public.session
      WHERE id = ${sessionId} AND ('better-auth:' || "userId") = ${scope.userId}
        AND "expiresAt" > clock_timestamp() FOR SHARE`);
    if (rows.length !== 1)
      throw new PersonalMemoryError({ reason: "unauthenticated" });
    return scope;
  } catch (error) {
    if (error instanceof SqlError) {
      throw new PersonalMemoryError({ reason: "unavailable" });
    }
    throw error;
  }
};

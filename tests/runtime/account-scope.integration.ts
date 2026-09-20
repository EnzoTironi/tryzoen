import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import { ensureScope } from "../../db/services/scope";
import { ChannelAccounts } from "../../server/accounts";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { linkedIdentity } from "./identity-fixture";
test("a linked account owns its scope once and sender resolution never restores revoked membership", async () => {
  const accounts = ChannelAccounts;
  const sender = {
    channel: "telegram" as const,
    installationId: `scope-${randomUUID()}`,
    senderId: "scope-owner",
  };
  const identity = await linkedIdentity(sender);
  const scope = accessScopeForUser(`better-auth:${identity.userId}`);
  try {
    await Promise.try(async () => {
      const members = await query(sql`SELECT user_id FROM workspace_memberships
          WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}`);
      assert.equal(
        members.length,
        1,
        "a linked account must already own its workspace"
      );
      await ensureScope(scope);
      const other = {
        ...scope,
        userId: `better-auth:${randomUUID()}`,
      };
      await assert.rejects(ensureScope(other), {
        _tag: "ScopeAccessDenied",
      });
      await query(
        sql`DELETE FROM workspace_memberships WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}`
      );
      await assert.rejects(ensureScope(scope), {
        _tag: "ScopeAccessDenied",
      });
      assert.deepEqual(await accounts.resolveVerifiedSender(sender), {
        status: "linked",
        identity,
      });
      const remaining = await query(
        sql`SELECT user_id FROM workspace_memberships WHERE workspace_id = ${scope.workspaceId}`
      );
      assert.equal(
        remaining.length,
        0,
        "neither scope setup nor repeated sender resolution may restore access"
      );
    });
  } finally {
    await query(sql`DELETE FROM public."user" WHERE id = ${identity.userId}`);
    await query(sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`);
  }
});

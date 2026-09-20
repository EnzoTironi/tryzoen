import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { accessScopeForUser } from "../../shared/identity/access-scope";
import { applicationOrigin } from "../../shared/environment/origin";
import type { SessionAuthContext } from "eve/context";

import {
  createGoogleWorkspaceChallenge,
  readGoogleWorkspaceChallenge,
} from "./challenge";
import { requireGoogleWorkspaceMembership } from "./index";

const userId = `google-membership-${randomUUID()}`;
const scope = accessScopeForUser(`better-auth:${userId}`);
const principal: SessionAuthContext = {
  attributes: { workspaceId: scope.workspaceId },
  authenticator: "test",
  principalId: scope.userId,
  principalType: "user",
};
const callback = `${applicationOrigin()}/eve/v1/connections/google-workspace/callback/attempt/token`;

try {
  await (async function () {
    await query(sql`INSERT INTO workspaces (id) VALUES (${scope.workspaceId})`);
    await query(
      sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${scope.workspaceId}, ${scope.userId}, 'owner')`
    );
  })();
  const challenge = new URL(
    await createGoogleWorkspaceChallenge(principal, callback)
  );
  const flow = challenge.searchParams.get("flow");
  assert.ok(flow);
  assert.equal(await readGoogleWorkspaceChallenge(flow, userId), callback);
  await (async function () {
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${scope.workspaceId} AND user_id = ${scope.userId}`
    );
  })();
  await assert.rejects(requireGoogleWorkspaceMembership(scope), {
    reason: "unauthenticated",
  });
  await assert.rejects(createGoogleWorkspaceChallenge(principal, callback), {
    reason: "unauthenticated",
  });
  process.stdout.write(
    "PASS real PostgreSQL: revoked membership denies authorization and challenge issuance\n"
  );
} finally {
  await (async function () {
    await query(sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`);
  })();
}

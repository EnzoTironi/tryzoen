import { env } from "@shared/environment/env";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SessionAuthContext } from "eve/context";
import { test } from "vitest";
import { authorizeApprovalResponse } from "../../agent/lib/approval-response";
import { channelPrincipal } from "../../server/channels/principal";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { linkedIdentity } from "./identity-fixture";
test("approval responses require the exact native owner, current identity and owned session", async () => {
  const url = env.DATABASE_URL;
  assert.equal(new URL(url).pathname, "/companion_runtime_test");
  const identity = await linkedIdentity({
    channel: "telegram",
    installationId: randomUUID(),
    senderId: "approval-owner",
  });
  const scope = accessScopeForUser(`better-auth:${identity.userId}`);
  const sessionId = randomUUID();
  const auth = channelPrincipal(identity);
  const context = (responder: SessionAuthContext, id = sessionId) => ({
    responder,
    session: {
      id,
      initiator: auth,
    },
  });
  try {
    await (async function () {
      await query(
        sql`INSERT INTO agent_sessions (session_id, workspace_id, created_by_user_id) VALUES (${sessionId}, ${scope.workspaceId}, ${scope.userId})`
      );
    })();
    assert.deepEqual(await authorizeApprovalResponse(context(auth)), {
      status: "allowed",
    });
    assert.equal(
      (await authorizeApprovalResponse(context(auth, randomUUID()))).status,
      "rejected"
    );
    assert.equal(
      (
        await authorizeApprovalResponse(
          context({
            ...auth,
            principalId: `better-auth:${randomUUID()}`,
          })
        )
      ).status,
      "rejected"
    );
    assert.equal(
      (
        await authorizeApprovalResponse(
          context({
            ...auth,
            attributes: {
              ...auth.attributes,
              channelIdentityId: randomUUID(),
            },
          })
        )
      ).status,
      "rejected"
    );
    await assert.rejects(() =>
      Promise.resolve(
        authorizeApprovalResponse(
          context({
            ...auth,
            attributes: {
              ...auth.attributes,
              conversationChannel: "eve",
            },
          })
        )
      )
    );
    await (async function () {
      await query(
        sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identity.id}`
      );
    })();
    await assert.rejects(() =>
      Promise.resolve(authorizeApprovalResponse(context(auth)))
    );
  } finally {
    await (async function () {
      await query(sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`);
      await query(sql`DELETE FROM public."user" WHERE id = ${identity.userId}`);
    })();
  }
});

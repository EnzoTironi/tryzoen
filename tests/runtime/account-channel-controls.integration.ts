import { createHmac, randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import { linkedIdentity } from "./identity-fixture";
import {
  readLinkedChannelIdentities,
  revokeLinkedChannelIdentity,
  AccountControlError,
} from "../../server/accounts/controls";

async function sessionHeaders(token: string) {
  const { betterAuthSecret } = await getInstallationSecrets();
  const signature = createHmac("sha256", betterAuthSecret)
    .update(token)
    .digest("base64");
  return new Headers({
    cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  });
}
test("linked-channel controls isolate owners, preserve last access, and unlink with session revocation", async () => {
  await using workspace = await workspaceFixture();
  const headers = await sessionHeaders(workspace.actor.authSessionId);
  const userId = workspace.actor.userId.slice("better-auth:".length);
  const installationId = `channel-controls-${randomUUID()}`;
  const first = await linkedIdentity(
    { channel: "telegram", installationId, senderId: "synthetic-first" },
    { userId }
  );
  const foreign = await linkedIdentity(
    { channel: "telegram", installationId, senderId: "synthetic-foreign" },
    { userId: workspace.guest.userId.slice("better-auth:".length) }
  );
  expect(await readLinkedChannelIdentities(headers)).toEqual([
    { id: first.id, channel: "telegram", senderId: "synthetic-first" },
  ]);
  await expect(
    revokeLinkedChannelIdentity(headers, foreign.id)
  ).rejects.toBeInstanceOf(AccountControlError);
  expect(await revokeLinkedChannelIdentity(headers, first.id)).toEqual({
    status: "last_access",
  });
  expect(
    await query(
      sql`SELECT id FROM public.session WHERE id=${workspace.actor.authSessionId}`
    )
  ).toHaveLength(1);
  expect(await readLinkedChannelIdentities(headers)).toHaveLength(1);
  const second = await linkedIdentity(
    { channel: "kapso", installationId, senderId: "synthetic-second" },
    { userId }
  );
  expect(await revokeLinkedChannelIdentity(headers, first.id)).toEqual({
    status: "revoked",
  });
  expect(
    await query(sql`SELECT id FROM public.session WHERE "userId"=${userId}`)
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT id FROM public.channel_identity WHERE id=${first.id} AND revoked_at IS NOT NULL`
    )
  ).toHaveLength(1);
  expect(
    await query(
      sql`SELECT id FROM public.channel_identity WHERE id=${second.id} AND revoked_at IS NULL`
    )
  ).toHaveLength(1);
  await expect(readLinkedChannelIdentities(headers)).rejects.toBeInstanceOf(
    AccountControlError
  );
});
test("removed personal membership denies linked-channel metadata and mutation", async () => {
  await using workspace = await workspaceFixture();
  const headers = await sessionHeaders(workspace.actor.authSessionId);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id=${workspace.personal.workspaceId} AND user_id=${workspace.actor.userId}`
  );
  await expect(readLinkedChannelIdentities(headers)).rejects.toBeInstanceOf(
    AccountControlError
  );
  await expect(
    revokeLinkedChannelIdentity(headers, randomUUID())
  ).rejects.toBeInstanceOf(AccountControlError);
});

test("concurrent unlink operations serialize before session locks and cannot reuse a revoked session", async () => {
  await using workspace = await workspaceFixture();
  const headers = await sessionHeaders(workspace.actor.authSessionId);
  const userId = workspace.actor.userId.slice("better-auth:".length);
  const installationId = `channel-controls-${randomUUID()}`;
  const first = await linkedIdentity(
    { channel: "telegram", installationId, senderId: "parallel-first" },
    { userId }
  );
  const second = await linkedIdentity(
    { channel: "kapso", installationId, senderId: "parallel-second" },
    { userId }
  );
  const results = await Promise.allSettled([
    revokeLinkedChannelIdentity(headers, first.id),
    revokeLinkedChannelIdentity(headers, second.id),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1
  );
  expect(
    await query(
      sql`SELECT id FROM public.channel_identity WHERE user_id=${userId} AND revoked_at IS NULL`
    )
  ).toHaveLength(1);
  expect(
    await query(sql`SELECT id FROM public.session WHERE "userId"=${userId}`)
  ).toHaveLength(0);
});

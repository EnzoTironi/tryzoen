import { onTestFinished } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  channelPrincipal,
  requireChannelPrincipal,
} from "../../server/channels/principal";
import { linkedIdentity } from "./identity-fixture";
import { accessScopeForUser } from "../../shared/identity/access-scope";
test("channel callbacks require the current identity, owner, workspace and conversation", async () => {
  const identity = await linkedIdentity({
    channel: "telegram",
    installationId: randomUUID(),
    senderId: "918273",
  });
  onTestFinished(async () => {
    await Promise.try(async () =>
      query(
        sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${identity.userId}`).workspaceId}`
      )
    ).then(() =>
      query(sql`DELETE FROM public."user" WHERE id = ${identity.userId}`)
    );
  });
  const auth = channelPrincipal(identity, "message-5");
  expect(await requireChannelPrincipal("telegram", auth)).toEqual(identity);
  const invalid = [
    null,
    {
      ...auth,
      principalId: `better-auth:${randomUUID()}`,
    },
    {
      ...auth,
      principalType: "service",
    },
    {
      ...auth,
      attributes: {
        ...auth.attributes,
        workspaceId: "another-workspace",
      },
    },
    {
      ...auth,
      attributes: {
        ...auth.attributes,
        conversationId: randomUUID(),
      },
    },
    {
      ...auth,
      attributes: {
        ...auth.attributes,
        conversationChannel: "kapso",
      },
    },
    {
      ...auth,
      attributes: {
        ...auth.attributes,
        channelIdentityId: randomUUID(),
      },
    },
    {
      ...auth,
      attributes: {
        ...auth.attributes,
        channelIdentityId: [identity.id],
      },
    },
  ];
  for (const principal of invalid) {
    expect(
      await Promise.try(async () =>
        requireChannelPrincipal("telegram", principal)
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).toMatchObject({
      ok: false,
    });
  }
  await query(
    sql`UPDATE public.channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identity.id}`
  );
  expect(
    await Promise.try(async () =>
      requireChannelPrincipal("telegram", auth)
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  ).toMatchObject({
    ok: false,
  });
});

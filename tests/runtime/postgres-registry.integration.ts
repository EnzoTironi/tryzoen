import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  connectTools,
  discoverToolConnections,
  listToolConnections,
  revokeToolConnection,
  toolConnectionCredentials,
} from "../../server/connectors/connections";
import { resolveWorkspaceBillingSubject } from "../../server/workspaces/billing";
import { workspaceFixture } from "./workspace-fixture";
import { linkedIdentity } from "./identity-fixture";

// App-registry/authority journey only. It never opens a warehouse socket or
// enables the future governed source transport/admission path.
for (const scope of ["personal", "company"] as const) {
  test(`${scope} PostgreSQL registration is typed, replay-stable, private and revocable`, async () => {
    await using fixture = await workspaceFixture();
    const actor = scope === "personal" ? fixture.personal : fixture.actor;
    const input = {
      id: randomUUID(),
      kind: "postgres" as const,
      name: "Synthetic studio",
      configuration: {
        host: "DB.Example.Com",
        port: 5432,
        database: "studio",
        tls: "verify-full" as const,
      },
      credential: {
        username: "synthetic-reader",
        password: "synthetic-private-password",
      },
      share: "owner" as const,
    };
    const connection = await connectTools(actor, input);
    expect(await connectTools(actor, input)).toEqual(connection);
    expect(connection).toMatchObject({
      kind: "postgres",
      endpoint: null,
      operations: null,
      postgres_config: { ...input.configuration, host: "db.example.com" },
    });
    expect(JSON.stringify(connection)).not.toContain(input.credential.password);
    const [stored] = await query<{ credentials: string }>(
      sql`SELECT credentials FROM tool_connections WHERE id=${connection.id}`
    );
    expect(stored?.credentials).toBeTypeOf("string");
    expect(stored?.credentials).not.toContain(input.credential.password);
    expect(
      await listToolConnections(
        scope === "personal" ? fixture.guestPersonal : fixture.guest
      )
    ).toEqual([]);
    expect((await discoverToolConnections(actor, {})).connections).toEqual([]);
    await expect(
      discoverToolConnections(actor, { connectionId: connection.id })
    ).rejects.toMatchObject({ reason: "denied" });
    await expect(
      toolConnectionCredentials(actor, connection.id, connection.revision)
    ).rejects.toMatchObject({ reason: "denied" });
    const payer = await resolveWorkspaceBillingSubject(actor);
    expect(payer).toEqual(
      scope === "personal"
        ? {
            subjectType: "user",
            subjectId: actor.userId.slice("better-auth:".length),
          }
        : {
            subjectType: "organization",
            subjectId: (
              await query<{ organization_id: string }>(
                sql`SELECT organization_id FROM workspaces WHERE id=${actor.workspaceId}`
              )
            )[0]?.organization_id,
          }
    );
    await revokeToolConnection(actor, connection.id);
    expect(await listToolConnections(actor)).toEqual([]);
    const [revoked] = await query<{
      credentials: string | null;
      revision: string;
      revoked: boolean;
    }>(
      sql`SELECT credentials,revision,revoked_at IS NOT NULL AS revoked FROM tool_connections WHERE id=${connection.id}`
    );
    expect(revoked?.credentials).toBeNull();
    expect(revoked?.revoked).toBe(true);
    expect(revoked?.revision).not.toBe(connection.revision);
  });
}
test("team sharing does not grant registration, and owner offboarding removes its connection", async () => {
  await using fixture = await workspaceFixture();
  const input = {
    id: randomUUID(),
    kind: "postgres" as const,
    name: "Synthetic shared studio",
    configuration: {
      host: "db.example.com",
      port: 5432,
      database: "studio",
      tls: "verify-full" as const,
    },
    credential: {
      username: "synthetic-reader",
      password: "synthetic-private-password",
    },
    share: "workspace" as const,
  };
  const connection = await connectTools(fixture.actor, input);
  expect(await listToolConnections(fixture.guest)).toEqual([connection]);
  await expect(
    connectTools(fixture.guest, { ...input, id: randomUUID() })
  ).rejects.toThrow("WorkspaceAccessDenied");
  await query(
    sql`DELETE FROM organization_memberships WHERE organization_id=(SELECT organization_id FROM workspaces WHERE id=${fixture.actor.workspaceId}) AND user_id=${fixture.actor.userId}`
  );
  expect(await listToolConnections(fixture.guest)).toEqual([]);
  expect(
    await query(sql`SELECT id FROM tool_connections WHERE id=${connection.id}`)
  ).toEqual([]);
  await expect(resolveWorkspaceBillingSubject(fixture.actor)).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
});

test("a verified private channel cannot receive PostgreSQL metadata or a source payer", async () => {
  await using fixture = await workspaceFixture();
  const actor = fixture.personal;
  await connectTools(actor, {
    id: randomUUID(),
    kind: "postgres",
    name: "Synthetic private studio",
    configuration: {
      host: "db.example.com",
      port: 5432,
      database: "studio",
      tls: "verify-full",
    },
    credential: {
      username: "synthetic-reader",
      password: "synthetic-private-password",
    },
    share: "owner",
  });
  const linked = await linkedIdentity(
    {
      channel: "telegram",
      installationId: "synthetic-registry",
      senderId: randomUUID(),
    },
    { userId: actor.userId.slice("better-auth:".length) }
  );
  const channelActor = {
    ...actor,
    authSessionId: undefined,
    channelIdentityId: linked.id,
  };
  expect(await listToolConnections(channelActor)).toEqual([]);
  await expect(resolveWorkspaceBillingSubject(channelActor)).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
});

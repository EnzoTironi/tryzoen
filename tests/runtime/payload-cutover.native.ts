import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { query } from "@db/queries";
import { env } from "@shared/environment/env";
import { dbMigrationEnv } from "../../db/env/migration";
import { Artifacts } from "../../server/artifacts";
import { ErasureJournal } from "../../server/accounts/erasure-journal";
import { migrateApplication } from "../../server/database/migrations";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import { publishPrivateMemoryGit } from "../../server/memory/git";
import { Messaging } from "../../server/messaging";
import { payloadDigest } from "../../server/payloads/s3";
import { publishWorkspaceGit } from "../../server/workspaces/git";
import { workspaceFixture } from "./workspace-fixture";
import { requireRuntimeDatabase } from "./database";

test("native staged cutover preserves all four payload owners, survives a rejected pointer commit and honors restore-independent erasure", async () => {
  await requireRuntimeDatabase();
  if (
    env.ZOEN_PAYLOAD_ENDPOINT !== "http://127.0.0.1:19480" ||
    env.ZOEN_PAYLOAD_BUCKET !== "synthetic-storage-2a69cdcd" ||
    env.ZOEN_ERASURE_JOURNAL_ENDPOINT !== "http://127.0.0.1:19480" ||
    env.ZOEN_ERASURE_JOURNAL_BUCKET !== "synthetic-erasure-cutover"
  )
    throw new Error("Cutover proof requires the owned native storage fixtures");
  const migrationUrl = new URL(dbMigrationEnv.DATABASE_URL_UNPOOLED);
  if (
    migrationUrl.hostname !== "127.0.0.1" ||
    migrationUrl.port !== "15432" ||
    migrationUrl.pathname !== "/companion_runtime_test" ||
    migrationUrl.username !== "zoen_migrator"
  )
    throw new Error("Cutover proof requires the owned migration role");
  const migration = new Client({
    connectionString: migrationUrl.toString(),
    connectionTimeoutMillis: 5000,
  });
  await migration.connect();
  try {
    const before = await migration.query(
      "SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations"
    );
    expect(before.rows).toEqual([{ count: 108 }]);
    vi.stubEnv("ZOEN_PAYLOAD_BUCKET", "");
    try {
      await expect(migrateApplication(migrationUrl.toString())).rejects.toThrow(
        "Private payload configuration is missing or invalid"
      );
      expect(
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations"
          )
        ).rows
      ).toEqual([{ count: 108 }]);
    } finally {
      vi.unstubAllEnvs();
    }
    await using fixture = await workspaceFixture();
    const { actor, guest, repository } = fixture;
    const sourceBytes = Buffer.from("Synthetic imported production: 42 units.");
    const shared = await publishWorkspaceGit({
      bundle: null,
      parent: null,
      changes: [
        {
          path: "knowledge/production.md",
          content: "Daily production: 42 units.",
        },
      ],
      message: "Synthetic cutover source",
    });
    await query(sql`INSERT INTO workspace_repository(workspace_id,head_sha,bundle)
      VALUES (${actor.workspaceId},${shared.revision},${shared.bundle})`);
    await query(sql`INSERT INTO workspace_revision(workspace_id,revision,operation_id,request_hash,paths,author_user_id,source,source_sha256)
      VALUES (${actor.workspaceId},${shared.revision},${randomUUID()},${payloadDigest("synthetic-cutover")},
        ARRAY['knowledge/production.md'],${actor.userId},'import',${payloadDigest(sourceBytes)})`);
    await query(sql`INSERT INTO workspace_source(workspace_id,revision,filename,content)
      VALUES (${actor.workspaceId},${shared.revision},'production.txt',${sourceBytes})`);

    const namespace = { id: randomUUID() };
    await query(sql`INSERT INTO workspace_memory_namespace(workspace_id,user_id,namespace_id)
      VALUES (${actor.workspaceId},${actor.userId},${namespace.id})`);
    await query(
      sql`INSERT INTO private_memory_repository(namespace_id) VALUES (${namespace.id})`
    );
    const claim = await publishPrivateMemoryGit({
      scope: { workspaceId: actor.workspaceId, userId: actor.userId },
      bundle: null,
      head: null,
      change: {
        action: "assert",
        operationId: randomUUID(),
        claimId: randomUUID(),
        expectedRevision: null,
        body: {
          text: "Synthetic owner's retained private preference",
          sources: [],
          relations: [],
          validTime: null,
        },
      },
      publication: async () => ({
        authorUserId: actor.userId,
        recordedAt: "2026-10-03T23:00:00.000001Z",
      }),
    });
    if (!claim.applied)
      throw new Error("Expected a native private Git publication");
    await query(sql`UPDATE private_memory_repository SET head_sha=${claim.receipt.revision},bundle=${claim.bundle},recorded_at=${claim.snapshot.recordedAt}::timestamptz
      WHERE namespace_id=${namespace.id}`);

    const identityId = randomUUID();
    await query(sql`INSERT INTO channel_identity(id,channel,installation_id,sender_id,user_id)
      VALUES (${identityId},'telegram','synthetic-cutover',${identityId},${actor.userId.slice("better-auth:".length)})`);
    const eventId = randomUUID();
    const mediaId = randomUUID();
    const accepted = await Messaging.accept({
      identityId,
      eventId,
      sourceMessageId: eventId,
      payload: {
        attachments: [
          { id: mediaId, name: "attachment.txt", mediaType: "text/plain" },
        ],
      },
    });
    const artifactId = randomUUID();
    const attachment = Buffer.from(
      "Synthetic private attachment retained through cutover"
    );
    await query(sql`INSERT INTO private_artifact(id,owner_user_id,workspace_id,source_identity_id,source_inbox_id,
      source_event_id,source_message_id,source_media_id,filename,media_type,byte_length,sha256,content)
      VALUES (${artifactId},${actor.userId},${fixture.personal.workspaceId},${identityId},${accepted.id},${eventId},${eventId},${mediaId},
        'attachment.txt','text/plain',${attachment.byteLength},${payloadDigest(attachment)},${attachment})`);

    const erased = { id: randomUUID() };
    await query(sql`INSERT INTO workspace_memory_namespace(workspace_id,user_id,namespace_id)
      VALUES (${guest.workspaceId},${guest.userId},${erased.id})`);
    await query(
      sql`INSERT INTO private_memory_repository(namespace_id) VALUES (${erased.id})`
    );
    const erasedClaim = await publishPrivateMemoryGit({
      scope: { workspaceId: guest.workspaceId, userId: guest.userId },
      bundle: null,
      head: null,
      change: {
        action: "assert",
        operationId: randomUUID(),
        claimId: randomUUID(),
        expectedRevision: null,
        body: {
          text: "Synthetic erased fact must never be transferred",
          sources: [],
          relations: [],
          validTime: null,
        },
      },
      publication: async () => ({
        authorUserId: guest.userId,
        recordedAt: "2026-10-03T23:00:00.000002Z",
      }),
    });
    if (!erasedClaim.applied)
      throw new Error("Expected the synthetic erased Git fixture");
    await query(sql`UPDATE private_memory_repository SET head_sha=${erasedClaim.receipt.revision},bundle=${erasedClaim.bundle},recorded_at=${erasedClaim.snapshot.recordedAt}::timestamptz
      WHERE namespace_id=${erased.id}`);
    await ErasureJournal.append({
      userId: guest.userId,
      matrixIds: [],
      departures: [],
    });
    const erasedNamespace = randomUUID();
    const namespaceClaim = await publishPrivateMemoryGit({
      scope: {
        workspaceId: fixture.personal.workspaceId,
        userId: actor.userId,
      },
      bundle: null,
      head: null,
      change: {
        action: "assert",
        operationId: randomUUID(),
        claimId: randomUUID(),
        expectedRevision: null,
        body: {
          text: "Synthetic namespace-only erased fact",
          sources: [],
          relations: [],
          validTime: null,
        },
      },
      publication: async () => ({
        authorUserId: actor.userId,
        recordedAt: "2026-10-04T00:00:00.000001Z",
      }),
    });
    if (!namespaceClaim.applied)
      throw new Error("Expected the namespace-only fixture");
    await query(sql`INSERT INTO workspace_memory_namespace(workspace_id,user_id,namespace_id)
      VALUES (${fixture.personal.workspaceId},${actor.userId},${erasedNamespace})`);
    await query(sql`INSERT INTO private_memory_repository(namespace_id,head_sha,bundle,recorded_at)
      VALUES (${erasedNamespace},${namespaceClaim.receipt.revision},${namespaceClaim.bundle},${namespaceClaim.snapshot.recordedAt}::timestamptz)`);
    await ErasureJournal.appendMemoryNamespace({
      kind: "private-memory",
      ownerUserId: actor.userId,
      namespaceId: erasedNamespace,
    });
    const fault = `synthetic_cutover_${artifactId.replaceAll("-", "")}`;
    await migration.query(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN IF NEW.id='${z.uuid().parse(artifactId)}'::uuid AND NEW.payload_object_id IS NOT NULL THEN
        RAISE EXCEPTION 'synthetic cutover pointer failure'; END IF; RETURN NEW; END $body$;
      CREATE CONSTRAINT TRIGGER ${fault} AFTER UPDATE ON private_artifact
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fault}()`);
    try {
      await expect(migrateApplication(migrationUrl.toString())).rejects.toThrow(
        "Application migration failed"
      );
      const preparation = await migration.query(
        `SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations`
      );
      expect(preparation.rows).toEqual([{ count: 109 }]);
      const unpublished = await query(
        sql`SELECT payload_object_id AS id FROM private_artifact WHERE id=${artifactId}`
      );
      expect(unpublished).toEqual([{ id: null }]);
      const retained = await query(
        sql`SELECT kind,state FROM payload_object ORDER BY kind,state`
      );
      expect(retained).toEqual([
        { kind: "private-artifact", state: "pending" },
        { kind: "private-memory-bundle", state: "adopted" },
        { kind: "workspace-bundle", state: "adopted" },
        { kind: "workspace-source", state: "adopted" },
      ]);
    } finally {
      await migration.query(
        `DROP TRIGGER ${fault} ON private_artifact; DROP FUNCTION ${fault}()`
      );
    }
    const completed = await migrateApplication(migrationUrl.toString());
    expect(completed.applicationMigrations).toBe(114);
    expect(await migrateApplication(migrationUrl.toString())).toEqual(
      completed
    );
    expect(
      (await repository.read(actor, "knowledge/production.md")).content
    ).toBe("Daily production: 42 units.");
    expect((await repository.export(actor))?.head).toBe(shared.revision);
    expect(
      Buffer.from((await repository.source(actor, shared.revision)).bytes)
    ).toEqual(sourceBytes);
    const privateRead = await PrivateMemoryRepository.read(actor);
    expect(privateRead.snapshot.revision).toBe(claim.receipt.revision);
    expect(privateRead.snapshot.claims[0]?.file.state).toMatchObject({
      kind: "active",
      body: { text: "Synthetic owner's retained private preference" },
    });
    expect(
      Buffer.from((await Artifacts.read({ identityId, artifactId })).bytes)
    ).toEqual(attachment);
    const removed = await query(
      sql`SELECT namespace_id FROM workspace_memory_namespace WHERE namespace_id=${erased.id}`
    );
    expect(removed).toEqual([]);
    expect(
      await query(
        sql`SELECT namespace_id FROM workspace_memory_namespace WHERE namespace_id=${erasedNamespace}`
      )
    ).toEqual([]);
    expect(
      await query(
        sql`SELECT id FROM workspaces WHERE id=${fixture.personal.workspaceId}`
      )
    ).toEqual([{ id: fixture.personal.workspaceId }]);
    expect(
      await query(
        sql`SELECT id FROM workspaces WHERE id=${fixture.guestPersonal.workspaceId}`
      )
    ).toEqual([]);
    expect(
      await query(sql`SELECT id FROM workspaces WHERE id=${actor.workspaceId}`)
    ).toEqual([{ id: actor.workspaceId }]);
    expect(
      await query(
        sql`SELECT id FROM public.session WHERE id=${actor.authSessionId}`
      )
    ).toEqual([{ id: actor.authSessionId }]);
    const removedColumns =
      await query(sql`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND ((table_name IN ('workspace_repository','private_memory_repository') AND column_name='bundle')
        OR (table_name IN ('workspace_source','private_artifact') AND column_name='content'))`);
    expect(removedColumns).toEqual([]);
  } finally {
    await migration.end();
  }
});

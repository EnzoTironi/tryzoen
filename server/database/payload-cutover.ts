import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "pg";
import { z } from "zod";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { ErasureJournal } from "../accounts/erasure-journal";
import { readPrivateMemoryGit } from "../memory/git";
import { operationSignal } from "../operations/async";
import {
  PayloadReferenceSchema,
  PayloadScopeSchema,
} from "../payloads/contract";
import { openPayloads } from "../payloads/connection";
import { payloadDigest } from "../payloads/s3";
import { readWorkspaceGit } from "../workspaces/git";

const journalSchema = z.looseObject({
  entries: z.array(
    z.looseObject({
      idx: z.number().int().nonnegative(),
      tag: z.string().regex(/^\d{4}_[a-z0-9_-]+$/u),
    })
  ),
});

/** Drizzle applies an unchanged prefix to its native journal. The temporary
 * folder changes only which pending entries run before the bounded transfer. */
export async function payloadPreparationFolder(folder: string) {
  const journal = journalSchema.parse(
    JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"))
  );
  const index = journal.entries.findIndex(
    (entry) => entry.tag === "0108_payload-registration"
  );
  if (
    index !== 108 ||
    journal.entries[index + 1]?.tag !== "0109_payload-references"
  )
    throw new Error("The payload cutover migration prefix is incomplete");
  const directory = await mkdtemp(join(tmpdir(), "zoen-payload-migrations-"));
  try {
    await mkdir(join(directory, "meta"));
    const entries = journal.entries.slice(0, index + 1);
    for (const entry of entries)
      await symlink(
        join(folder, `${entry.tag}.sql`),
        join(directory, `${entry.tag}.sql`)
      );
    await writeFile(
      join(directory, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries })
    );
    return {
      directory,
      preparationCount: entries.length,
      async [Symbol.asyncDispose]() {
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.string().regex(/^[a-f0-9]{40}$/u);
const bytes = z.instanceof(Uint8Array);
const legacyPayloadSchema = z.discriminatedUnion("kind", [
  PayloadScopeSchema.options[0].extend({ head: revision, bytes }),
  PayloadScopeSchema.options[1].extend({
    revision,
    expectedDigest: digest,
    bytes,
  }),
  PayloadScopeSchema.options[2].extend({ head: revision, bytes }),
  PayloadScopeSchema.options[3].extend({
    expectedDigest: digest,
    expectedLength: z.number().int().positive(),
    bytes,
  }),
]);
type LegacyPayload = z.infer<typeof legacyPayloadSchema>;

async function migrationTransaction<Value>(
  client: Client,
  run: () => Promise<Value>
) {
  await client.query("BEGIN");
  try {
    const result = await run();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** Restore-independent erasure intent is read before transferring old private
 * bytes. Startup's existing reconciler still owns the complete account wipe. */
async function discardErasedPayloadOwners(client: Client) {
  let after = "";
  for (;;) {
    operationSignal().throwIfAborted();
    const rows = await client.query(
      `SELECT user_id FROM (
      SELECT user_id FROM workspace_memory_namespace
      UNION SELECT owner_user_id FROM private_artifact
      UNION SELECT m.user_id FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id
        WHERE w.organization_id IS NULL
    ) owners WHERE user_id > $1 ORDER BY user_id LIMIT 1`,
      [after]
    );
    const [owner] = z
      .array(
        z.object({
          user_id: z.string().regex(/^better-auth:[a-zA-Z0-9_-]{1,160}$/u),
        })
      )
      .max(1)
      .parse(rows.rows);
    if (!owner) return;
    const userId = owner.user_id;
    after = userId;
    let erased = false;
    for await (const record of ErasureJournal.read(userId)) {
      if (record.userId !== userId) throw new Error("Erasure owner mismatch");
      erased = true;
      break;
    }
    if (!erased) continue;
    await migrationTransaction(client, async () => {
      await client.query(
        "DELETE FROM private_artifact WHERE owner_user_id=$1",
        [userId]
      );
      await client.query(
        "DELETE FROM workspace_memory_namespace WHERE user_id=$1",
        [userId]
      );
      await client.query(
        "DELETE FROM workspaces WHERE id=$1 AND organization_id IS NULL",
        [accessScopeForUser(userId).workspaceId]
      );
    });
  }
}

async function selectLegacyPayload(
  client: Client,
  kind: LegacyPayload["kind"],
  selected?: LegacyPayload
) {
  let statement: string;
  let parameters: string[] = [];
  switch (kind) {
    case "workspace-bundle":
      statement = `SELECT 'workspace-bundle' AS kind,r.workspace_id AS "workspaceId",
        w.payload_generation AS "ownerGeneration",NULL AS "ownerUserId",r.head_sha AS head,r.bundle AS bytes
        FROM workspace_repository r JOIN workspaces w ON w.id=r.workspace_id
        WHERE r.payload_object_id IS NULL ${selected ? "AND r.workspace_id=$1" : ""}
        ORDER BY r.workspace_id LIMIT 1 ${selected ? "FOR UPDATE OF r FOR SHARE OF w" : ""}`;
      if (selected) parameters = [selected.workspaceId];
      break;
    case "workspace-source":
      statement = `SELECT 'workspace-source' AS kind,s.workspace_id AS "workspaceId",
        w.payload_generation AS "ownerGeneration",NULL AS "ownerUserId",s.revision,
        r.source_sha256 AS "expectedDigest",s.content AS bytes
        FROM workspace_source s JOIN workspaces w ON w.id=s.workspace_id
        JOIN workspace_revision r ON r.workspace_id=s.workspace_id AND r.revision=s.revision
        WHERE s.payload_object_id IS NULL ${selected ? "AND s.workspace_id=$1 AND s.revision=$2" : ""}
        ORDER BY s.workspace_id,s.revision LIMIT 1 ${selected ? "FOR UPDATE OF s FOR SHARE OF w,r" : ""}`;
      if (selected?.kind === "workspace-source")
        parameters = [selected.workspaceId, selected.revision];
      break;
    case "private-memory-bundle":
      statement = `SELECT 'private-memory-bundle' AS kind,n.workspace_id AS "workspaceId",
        n.namespace_id AS "ownerGeneration",n.user_id AS "ownerUserId",r.head_sha AS head,r.bundle AS bytes
        FROM private_memory_repository r JOIN workspace_memory_namespace n ON n.namespace_id=r.namespace_id
        WHERE r.payload_object_id IS NULL AND r.head_sha IS NOT NULL ${selected ? "AND r.namespace_id=$1" : ""}
        ORDER BY r.namespace_id LIMIT 1 ${selected ? "FOR UPDATE OF r,n" : ""}`;
      if (selected) parameters = [selected.ownerGeneration];
      break;
    case "private-artifact":
      statement = `SELECT 'private-artifact' AS kind,a.workspace_id AS "workspaceId",a.id AS "ownerGeneration",
        a.owner_user_id AS "ownerUserId",a.sha256 AS "expectedDigest",a.byte_length AS "expectedLength",a.content AS bytes
        FROM private_artifact a WHERE a.payload_object_id IS NULL AND a.deleted_at IS NULL ${selected ? "AND a.id=$1" : ""}
        ORDER BY a.id LIMIT 1 ${selected ? "FOR UPDATE OF a" : ""}`;
      if (selected) parameters = [selected.ownerGeneration];
      break;
    default: {
      const exhaustive: never = kind;
      throw new Error(String(exhaustive));
    }
  }
  const result = await client.query(statement, parameters);
  return result.rows.length ? legacyPayloadSchema.parse(result.rows[0]) : null;
}

async function publishPointer(
  client: Client,
  row: LegacyPayload,
  candidateId: string
) {
  switch (row.kind) {
    case "workspace-bundle":
      return client.query(
        "UPDATE workspace_repository SET payload_object_id=$1 WHERE workspace_id=$2 AND payload_object_id IS NULL",
        [candidateId, row.workspaceId]
      );
    case "workspace-source":
      return client.query(
        "UPDATE workspace_source SET payload_object_id=$1 WHERE workspace_id=$2 AND revision=$3 AND payload_object_id IS NULL",
        [candidateId, row.workspaceId, row.revision]
      );
    case "private-memory-bundle":
      return client.query(
        "UPDATE private_memory_repository SET payload_object_id=$1 WHERE namespace_id=$2 AND payload_object_id IS NULL",
        [candidateId, row.ownerGeneration]
      );
    case "private-artifact":
      return client.query(
        "UPDATE private_artifact SET payload_object_id=$1 WHERE id=$2 AND payload_object_id IS NULL AND deleted_at IS NULL",
        [candidateId, row.ownerGeneration]
      );
    default: {
      const exhaustive: never = row;
      throw new Error(String(exhaustive));
    }
  }
}

/** Maintenance-only transfer between native migrations 108 and 109. No web
 * reader or writer can use the temporary columns after the final migration. */
export async function transferLegacyPayloads(client: Client) {
  const pending = z.object({ present: z.boolean() }).parse(
    (
      await client.query(`SELECT EXISTS(SELECT 1 FROM workspace_repository)
    OR EXISTS(SELECT 1 FROM workspace_source) OR EXISTS(SELECT 1 FROM private_memory_repository WHERE head_sha IS NOT NULL)
    OR EXISTS(SELECT 1 FROM private_artifact WHERE deleted_at IS NULL) AS present`)
    ).rows[0]
  );
  if (!pending.present) return { transferred: 0 };
  await discardErasedPayloadOwners(client);
  const connection = openPayloads();
  let transferred = 0;
  try {
    for (const kind of PayloadScopeSchema.options.map(
      (schema) => schema.shape.kind.value
    )) {
      for (;;) {
        operationSignal().throwIfAborted();
        const next = await selectLegacyPayload(client, kind);
        if (!next) break;
        const candidate = await migrationTransaction(client, async () => {
          const row = await selectLegacyPayload(client, kind, next);
          if (!row) return null;
          if (row.kind === "workspace-bundle")
            await readWorkspaceGit(row.bytes, row.head);
          if (row.kind === "private-memory-bundle")
            await readPrivateMemoryGit({
              scope: { workspaceId: row.workspaceId, userId: row.ownerUserId },
              head: row.head,
              bundle: row.bytes,
            });
          const sha256 = payloadDigest(row.bytes);
          if ("expectedDigest" in row && row.expectedDigest !== sha256)
            throw new Error("Legacy payload integrity mismatch");
          if (
            row.kind === "private-artifact" &&
            row.expectedLength !== row.bytes.byteLength
          )
            throw new Error("Legacy artifact length mismatch");
          const reference = PayloadReferenceSchema.parse({
            kind: row.kind,
            workspaceId: row.workspaceId,
            ownerGeneration: row.ownerGeneration,
            ownerUserId: row.ownerUserId,
            candidateId: randomUUID(),
            sha256,
            byteLength: row.bytes.byteLength,
          });
          await client.query(
            `INSERT INTO payload_object(id,workspace_id,owner_generation,owner_user_id,kind,sha256,byte_length,created_at,write_until)
            SELECT $1,$2,$3,$4,$5,$6,$7,instant,instant+interval '2 minutes' FROM (SELECT clock_timestamp() AS instant) clock`,
            [
              reference.candidateId,
              reference.workspaceId,
              reference.ownerGeneration,
              reference.ownerUserId,
              reference.kind,
              reference.sha256,
              reference.byteLength,
            ]
          );
          return { row, reference };
        });
        if (!candidate) continue;
        await connection.payloads.putVerified({
          candidate: candidate.reference,
          bytes: candidate.row.bytes,
          signal: operationSignal(),
          deadlineMs: Date.now() + 30_000,
        });
        await migrationTransaction(client, async () => {
          const current = await selectLegacyPayload(
            client,
            kind,
            candidate.row
          );
          if (
            !current ||
            payloadDigest(current.bytes) !== candidate.reference.sha256 ||
            current.ownerGeneration !== candidate.row.ownerGeneration ||
            current.ownerUserId !== candidate.row.ownerUserId ||
            ("head" in current &&
              "head" in candidate.row &&
              current.head !== candidate.row.head)
          )
            throw new Error(
              "Payload owner changed during the maintenance transfer"
            );
          const verified = await client.query(
            `UPDATE payload_object SET verified_at=clock_timestamp()
            WHERE id=$1 AND state='pending' AND write_until>clock_timestamp() RETURNING id`,
            [candidate.reference.candidateId]
          );
          if (verified.rowCount !== 1)
            throw new Error("Payload transfer write window expired");
          await client.query(
            "UPDATE payload_object SET state='adopted',adopted_at=clock_timestamp() WHERE id=$1",
            [candidate.reference.candidateId]
          );
          if (
            (
              await publishPointer(
                client,
                current,
                candidate.reference.candidateId
              )
            ).rowCount !== 1
          )
            throw new Error("Payload pointer publication failed");
        });
        transferred++;
      }
    }
    return { transferred };
  } finally {
    connection.close();
  }
}

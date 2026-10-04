import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempDisposable,
  mkdir,
  open,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { z } from "zod";
import { query } from "@db/queries";
import { env } from "@shared/environment/env";
import { ErasureJournal } from "../../server/accounts/erasure-journal";
import { requirePrivateMemoryArchiveAuthentication } from "../../server/memory/archive";
import {
  decodePrivateMemoryArchive,
  encodePrivateMemoryArchive,
} from "../../server/memory/archive-codec";
import { drainMemoryErasures } from "../../server/memory/erasure";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import { openPayloads } from "../../server/payloads/connection";
import {
  PayloadReferenceSchema,
  type PayloadReference,
} from "../../server/payloads/contract";
import { drainPayloadErasures } from "../../server/payloads/erasure";
import { operationSignal } from "../../server/operations/async";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { removeWorkspaceMember } from "../../server/workspaces/team";
import { workspaceFixture } from "./workspace-fixture";

const body = (text: string) => ({
  text,
  sources: [],
  relations: [],
  validTime: null,
});

function replayActualStartup() {
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/reconcile-account-erasures.ts"],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }
  );
}

async function providerRead(reference: PayloadReference) {
  const connection = openPayloads();
  try {
    return await connection.payloads.readVerified({
      reference,
      signal: operationSignal(),
      deadlineMs: Date.now() + 5000,
    });
  } finally {
    connection.close();
  }
}

test("a complete old SQL restore cannot revive an accepted namespace erasure or republish erased bytes from an authentic archive", async () => {
  const database = new URL(env.DATABASE_URL);
  const container = process.env.ZOEN_RESTORE_TEST_CONTAINER ?? "";
  if (
    env.NODE_ENV !== "test" ||
    database.hostname !== "127.0.0.1" ||
    database.port !== "15432" ||
    database.pathname !== "/companion_runtime_test" ||
    database.username !== "zoen_app" ||
    !container.startsWith("zoen-payload-") ||
    env.ZOEN_PAYLOAD_ENDPOINT !== "http://127.0.0.1:19480" ||
    env.ZOEN_PAYLOAD_BUCKET !== "synthetic-storage-2a69cdcd" ||
    env.ZOEN_ERASURE_JOURNAL_BUCKET !== "synthetic-erasure-cutover" ||
    !env.ZOEN_SESSION_ARCHIVE_DIR
  )
    throw new Error(
      "Restore proof requires its owned PostgreSQL, object storage and archive fixtures"
    );
  await using fixture = await workspaceFixture();
  for (const [actor, text] of [
    [fixture.guest, "Synthetic guest memory to erase"],
    [fixture.actor, "Synthetic neighbor memory to retain"],
  ] satisfies [
    Parameters<typeof PrivateMemoryRepository.change>[0],
    string,
  ][]) {
    await PrivateMemoryRepository.change(actor, {
      action: "assert",
      operationId: randomUUID(),
      claimId: randomUUID(),
      expectedRevision: null,
      body: body(text),
    });
  }
  const backup = await PrivateMemoryRepository.backup(fixture.guest);
  expect(backup.revision).not.toBeNull();
  expect(backup.bundle).not.toBeNull();
  const namespaceId = backup.namespaceId;
  const reference = PayloadReferenceSchema.parse(
    (
      await query(sql`
    SELECT p.id AS "candidateId",p.kind,p.workspace_id AS "workspaceId",
      p.owner_user_id AS "ownerUserId",p.owner_generation AS "ownerGeneration",
      p.sha256,p.byte_length AS "byteLength"
    FROM payload_object p JOIN private_memory_repository r ON r.payload_object_id=p.id
    WHERE r.namespace_id=${namespaceId}`)
    )[0]
  );
  const originalBytes = await providerRead(reference);
  await using directory = await mkdtempDisposable(
    join(tmpdir(), "zoen-payload-restore-")
  );
  const archivePath = join(directory.path, "memory.zoen");
  await writeFile(archivePath, encodePrivateMemoryArchive(backup), {
    mode: 0o600,
  });
  const namespaceFiles = join(
    env.ZOEN_SESSION_ARCHIVE_DIR,
    namespaceId,
    "raw",
    "eve"
  );
  await mkdir(namespaceFiles, { recursive: true });
  const sourcePath = join(namespaceFiles, "synthetic.jsonl");
  await writeFile(sourcePath, "Synthetic private source to erase", {
    mode: 0o600,
  });

  const dumpPath = join(directory.path, "database.dump");
  await using dump = await open(dumpPath, "wx", 0o600);
  execFileSync(
    "docker",
    [
      "exec",
      container,
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      "companion_runtime_test",
      "-Fc",
    ],
    {
      stdio: ["ignore", dump.fd, "pipe"],
      timeout: 20_000,
    }
  );
  const restoreOldDatabase = async () => {
    await using input = await open(dumpPath, "r");
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "pg_restore",
        "--clean",
        "--if-exists",
        "--exit-on-error",
        "-U",
        "postgres",
        "-d",
        "companion_runtime_test",
      ],
      {
        stdio: [input.fd, "ignore", "pipe"],
        timeout: 20_000,
      }
    );
    expect(
      await query(
        sql`SELECT 1 FROM workspace_memory_namespace WHERE namespace_id=${namespaceId}`
      )
    ).toHaveLength(1);
    expect(
      await query(
        sql`SELECT 1 FROM workspace_memberships WHERE workspace_id=${fixture.guest.workspaceId} AND user_id=${fixture.guest.userId}`
      )
    ).toHaveLength(1);
    expect(
      await query(
        sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id=${namespaceId}`
      )
    ).toHaveLength(0);
    expect(
      await query(
        sql`SELECT 1 FROM payload_erasure WHERE scope_key=${namespaceId}`
      )
    ).toHaveLength(0);
  };
  const expectReplayedErasure = async () => {
    expect(
      await query(
        sql`SELECT 1 FROM workspace_memory_namespace WHERE namespace_id=${namespaceId}`
      )
    ).toHaveLength(0);
    expect(
      await query(
        sql`SELECT owner_user_id FROM payload_erasure WHERE scope_key=${namespaceId}`
      )
    ).toEqual([{ owner_user_id: fixture.guest.userId }]);
    expect(
      await query(
        sql`SELECT 1 FROM public.user WHERE id=${fixture.guest.userId.slice("better-auth:".length)}`
      )
    ).toHaveLength(1);
    expect(
      await query(
        sql`SELECT 1 FROM workspace_memberships WHERE workspace_id=${fixture.guest.workspaceId} AND user_id=${fixture.guest.userId}`
      )
    ).toHaveLength(1);
  };

  await removeWorkspaceMember(fixture.actor, fixture.guest.userId);
  const intents = [];
  for await (const record of ErasureJournal.readMemoryNamespaces(
    fixture.guest.userId
  ))
    intents.push(record);
  expect(intents).toEqual([
    {
      version: 1,
      kind: "private-memory",
      ownerUserId: fixture.guest.userId,
      namespaceId,
    },
  ]);
  expect(
    await query(
      sql`SELECT 1 FROM workspace_memory_namespace WHERE namespace_id=${namespaceId}`
    )
  ).toHaveLength(0);
  // Rewind immediately, before either erasure worker has run.
  await restoreOldDatabase();
  expect(Buffer.from(await providerRead(reference))).toEqual(
    Buffer.from(originalBytes)
  );
  replayActualStartup();
  await expectReplayedErasure();
  await drainMemoryErasures();
  const deadline = Date.now() + 145_000;
  for (;;) {
    await drainPayloadErasures();
    const [state] = z.array(z.object({ completed: z.boolean() })).parse(
      await query(sql`
      SELECT completed_at IS NOT NULL AS completed FROM payload_erasure
      WHERE owner_user_id=${fixture.guest.userId} AND scope_key=${namespaceId}`)
    );
    if (state?.completed) break;
    if (Date.now() >= deadline)
      throw new Error(
        "The real committed writer window did not close before the erasure deadline"
      );
    await delay(1000);
  }
  await expect(providerRead(reference)).rejects.toMatchObject({
    reason: "missing",
  });
  await query(
    sql`UPDATE workspace_memory_erasure SET available_at=clock_timestamp() WHERE namespace_id=${namespaceId}`
  );
  expect(await drainMemoryErasures()).toEqual({ cleared: 1 });
  await expect(readFile(sourcePath)).rejects.toMatchObject({ code: "ENOENT" });

  // A second complete rewind restores authority and the old head after bytes were erased.
  await restoreOldDatabase();
  await expect(providerRead(reference)).rejects.toMatchObject({
    reason: "missing",
  });
  replayActualStartup();
  await expectReplayedErasure();
  replayActualStartup();
  await expectReplayedErasure();
  const fresh = await PrivateMemoryRepository.read(fixture.guest);
  expect(fresh.snapshot.claims).toEqual([]);
  const archive = decodePrivateMemoryArchive(await readFile(archivePath));
  requirePrivateMemoryArchiveAuthentication(archive);
  if (archive.version !== 2)
    throw new Error("Expected the authentic claims archive");
  const rejected: unknown = await PrivateMemoryRepository.restore(
    fixture.guest,
    { expectedRevision: null, archive }
  ).then(
    () => undefined,
    (error: unknown) => error
  );
  expect(rejected).toBeInstanceOf(WorkspaceAccessDenied);
  await expect(providerRead(reference)).rejects.toMatchObject({
    reason: "missing",
  });
  expect(
    await query(
      sql`SELECT 1 FROM workspace_memory_namespace WHERE namespace_id=${namespaceId}`
    )
  ).toHaveLength(0);
  const neighbor = await PrivateMemoryRepository.read(fixture.actor);
  expect(neighbor.snapshot.claims.map((claim) => claim.file.state)).toEqual([
    { kind: "active", body: body("Synthetic neighbor memory to retain") },
  ]);
}, 180_000);

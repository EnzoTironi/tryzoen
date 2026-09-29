import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { unzipSync } from "fflate";
import { afterAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { LearnedMemory } from "../../server/memory/learned";
import { openMemoryEngine } from "../../server/memory/ai-memory/engine";
import {
  readNotes,
  readNoteHistory,
} from "../../server/memory/ai-memory/notes";
import { mutateNotes } from "../../server/memory/ai-memory/mutations";
import { workspaceFixture } from "./workspace-fixture";

const { directory } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  return {
    directory: await mkdtemp(path.join(tmpdir(), "zoen-backup-proof-")),
  };
});
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: { ...actual.env, ZOEN_SESSION_ARCHIVE_DIR: directory },
  };
});
afterAll(() => rm(directory, { recursive: true, force: true }));

test("exports an isolated complete learned corpus and restores native history and Zoen mutation receipts", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest } = workspace;
  const remember = {
    action: "remember" as const,
    operationId: randomUUID(),
    text: "The reading club meets in Cedarbay.",
  };
  const saved = await LearnedMemory.write(actor, remember);
  const asOf = new Date().toISOString();
  await delay(20);
  await LearnedMemory.write(actor, {
    action: "update",
    operationId: randomUUID(),
    memoryId: z.uuid().parse(saved.ids[0]),
    text: "The club now meets in Ambertrail.",
  });
  await LearnedMemory.write(guest, {
    action: "remember",
    operationId: randomUUID(),
    text: "The guest's private note is at Riverstone.",
  });
  await expect(
    LearnedMemory.backup({ ...actor, authSessionId: undefined })
  ).rejects.toMatchObject({ _tag: "WorkspaceAccessDenied" });
  await expect(
    LearnedMemory.backup({ ...actor, agentGrantId: randomUUID() })
  ).rejects.toMatchObject({ _tag: "WorkspaceAccessDenied" });
  await expect(
    LearnedMemory.backup({ ...actor, userId: guest.userId })
  ).rejects.toMatchObject({ _tag: "WorkspaceAccessDenied" });

  await LearnedMemory.setEnabled(actor, false);
  const archive = await LearnedMemory.backup(actor);
  const files = unzipSync(archive);
  const manifest = z
    .object({
      namespace: z.uuid(),
      corpus: z.literal("learned-memory"),
      files: z.record(
        z.string(),
        z.object({ bytes: z.number(), sha256: z.string() })
      ),
    })
    .parse(
      JSON.parse(
        Buffer.from(
          z.instanceof(Uint8Array).parse(files["manifest.json"])
        ).toString()
      )
    );
  for (const [name, details] of Object.entries(manifest.files)) {
    expect(files[name]?.byteLength).toBe(details.bytes);
    expect(
      createHash("sha256")
        .update(z.instanceof(Uint8Array).parse(files[name]))
        .digest("hex")
    ).toBe(details.sha256);
  }
  expect(
    Object.keys(files).filter((name) => name.startsWith("zoen-operations/"))
  ).toHaveLength(2);
  const snapshot = join(directory, "native.tar.gz");
  await writeFile(
    snapshot,
    z.instanceof(Uint8Array).parse(files["akita.tar.gz"]),
    { mode: 0o600 }
  );
  const root = join(directory, "quarantine");
  const restored = join(root, manifest.namespace, "learned-memory");
  await mkdir(join(root, manifest.namespace), { recursive: true, mode: 0o700 });
  const binary = z.string().min(1).parse(process.env.ZOEN_AI_MEMORY_BINARY);
  // Restore only into a fresh synthetic quarantine, never over an existing corpus.
  execFileSync(
    binary,
    ["--data-dir", restored, "restore", "--from", snapshot],
    {
      env: { PATH: "/usr/bin:/bin", HOME: directory, NODE_ENV: "test" },
      timeout: 30_000,
      stdio: "pipe",
    }
  );
  execFileSync("chmod", ["-R", "go-rwx", restored]);
  await chmod(root, 0o700);
  await mkdir(join(restored, "zoen-operations"), { mode: 0o700 });
  for (const [name, content] of Object.entries(files)) {
    if (/^zoen-operations\/[0-9a-f]{64}\.json$/.test(name))
      await writeFile(join(restored, name), content, {
        mode: 0o600,
        flag: "wx",
      });
  }
  {
    await using engine = await openMemoryEngine(
      binary,
      root,
      manifest.namespace,
      "learned-memory",
      { requireExisting: true }
    );
    expect((await readNotes(engine)).results[0]?.memory).toContain(
      "Ambertrail"
    );
    expect((await readNotes(engine, "Riverstone")).results).toEqual([]);
    expect(
      (await readNoteHistory(engine, { query: "Cedarbay", asOf })).hits[0]
        ?.excerpt
    ).toContain("Cedarbay");
    expect(await mutateNotes(engine, manifest.namespace, remember)).toEqual(
      saved
    );
    expect((await readNotes(engine)).results[0]?.memory).toContain(
      "Ambertrail"
    );
  }
  const original = await readFile(
    join(directory, manifest.namespace, "learned-memory", "db", "memory.sqlite")
  );
  await query(
    sql`UPDATE workspace_memory_namespace SET pending_operation = 'synthetic-interrupted-backup' WHERE namespace_id = ${manifest.namespace}`
  );
  await expect(LearnedMemory.backup(actor)).rejects.toMatchObject({
    reason: "stale_recall",
  });
  expect(
    await readFile(
      join(
        directory,
        manifest.namespace,
        "learned-memory",
        "db",
        "memory.sqlite"
      )
    )
  ).toEqual(original);
  await query(
    sql`DELETE FROM public.session WHERE id = ${actor.authSessionId}`
  );
  await expect(LearnedMemory.backup(actor)).rejects.toMatchObject({
    _tag: "WorkspaceAccessDenied",
  });
});

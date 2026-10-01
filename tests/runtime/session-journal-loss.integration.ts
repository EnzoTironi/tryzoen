import { createHash, randomUUID } from "node:crypto";
import { glob, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import { claimSession } from "../../db/services/sessions";
import {
  captureSessionSource,
  drainSessionSources,
} from "../../server/memory/session-capture";
import {
  decodeSessionSource,
  sessionSource,
  writeSessionSource,
} from "../../server/memory/session-files";
import {
  exportSessionSources,
  rebuildSessionSourceReceipts,
} from "../../server/memory/session-export";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import { privateMemoryFixture } from "./private-memory-fixture";

test.each(["event", "namespace", "volume", "event-and-receipt"] as const)(
  "lost retained %s bytes cannot become a complete journal after a fresh append",
  async (missing) => {
    await using fixture = await privateMemoryFixture();
    const actor = fixture.personal;
    const sessionId = `journal-loss-${randomUUID()}`;
    await claimSession(actor, sessionId);
    const first = sessionSource(
      {
        type: "message.received",
        meta: { id: randomUUID(), at: "2026-10-01T12:00:00.000Z" },
        data: {
          message: "Synthetic retained Cedarfield evidence.",
          sequence: 0,
          turnId: "first",
        },
      },
      sessionId
    );
    if (!first) throw new Error("Expected captured user source");
    await captureSessionSource(actor, first);
    expect(await drainSessionSources()).toEqual({
      stored: 1,
      configured: true,
    });
    const namespace = await fixture.namespace(actor);
    const publication = await PrivateMemoryRepository.change(actor, {
      action: "assert",
      operationId: randomUUID(),
      claimId: randomUUID(),
      expectedRevision: null,
      body: {
        text: "Cedarfield retained evidence",
        sources: [
          {
            kind: "session",
            sessionId,
            eventId: first.eventId,
            sha256: createHash("sha256")
              .update(JSON.stringify(first))
              .digest("hex"),
            excerpt: "Cedarfield evidence",
          },
        ],
        relations: [],
        validTime: null,
      },
    });
    expect(publication.applied).toBe(true);
    const paths = await Array.fromAsync(
      glob(join(fixture.root, namespace.id, "raw/eve/**/*.jsonl"))
    );
    const path = paths[0];
    if (!path) throw new Error("Expected retained event file");
    const target =
      missing === "event" || missing === "event-and-receipt"
        ? path
        : missing === "namespace"
          ? join(fixture.root, namespace.id)
          : fixture.root;
    const preserved = `${target}.preserved-${randomUUID()}`;
    await rename(target, preserved);
    let appended: ReturnType<typeof decodeSessionSource> | undefined;
    try {
      if (missing === "event-and-receipt")
        await query(
          sql`DELETE FROM memory_session_sources WHERE namespace_id=${namespace.id} AND event_id=${first.eventId}`
        );
      await expect(PrivateMemoryRepository.read(actor)).rejects.toMatchObject({
        reason: "unavailable",
      });
      await expect(
        PrivateMemoryRepository.recall(
          actor,
          `loss-${randomUUID()}`,
          randomUUID(),
          "Cedarfield"
        )
      ).rejects.toMatchObject({ reason: "unavailable" });
      await expect(PrivateMemoryRepository.backup(actor)).rejects.toMatchObject(
        { reason: "unavailable" }
      );
      await expect(
        PrivateMemoryRepository.backupCorpus(actor)
      ).rejects.toMatchObject({ reason: "unavailable" });
      await expect(
        exportSessionSources(actor, sessionId, new AbortController().signal)
      ).rejects.toThrow();
      const next = sessionSource(
        {
          type: "message.received",
          meta: { id: randomUUID(), at: "2026-10-01T12:01:00.000Z" },
          data: {
            message: "Synthetic fresh journal append.",
            sequence: 1,
            turnId: "next",
          },
        },
        sessionId
      );
      if (!next) throw new Error("Expected fresh user source");
      await captureSessionSource(actor, next);
      expect(await drainSessionSources()).toEqual({
        stored: 1,
        configured: true,
      });
      const [retained] = await query<{
        count: number;
        highWater: number;
        receipts: number;
      }>(sql`
        SELECT n.journal_event_count::float8 AS count, n.journal_high_water::float8 AS "highWater",
          (SELECT count(*)::int FROM memory_session_sources s WHERE s.namespace_id=n.namespace_id AND stored_at IS NOT NULL) AS receipts
        FROM workspace_memory_namespace n WHERE namespace_id=${namespace.id}`);
      expect(retained?.count).toBe(2);
      expect(retained?.receipts).toBe(missing === "event-and-receipt" ? 1 : 2);
      expect(retained?.highWater).toBeGreaterThan(
        namespace.journalHighWater ?? 0
      );
      await expect(
        PrivateMemoryRepository.backupCorpus(actor)
      ).rejects.toMatchObject({ reason: "unavailable" });
      await expect(
        exportSessionSources(actor, sessionId, new AbortController().signal)
      ).rejects.toThrow();
      const freshPaths = await Array.fromAsync(
        glob(join(fixture.root, namespace.id, "raw/eve/**/*.jsonl"))
      );
      expect(freshPaths).toHaveLength(1);
      const freshPath = freshPaths[0];
      if (!freshPath) throw new Error("Expected fresh retained event file");
      appended = decodeSessionSource(await readFile(freshPath));
      expect(appended.source.eventId).toBe(next.eventId);
    } finally {
      // Restore the exact displaced fixture, including any other fixture-owned
      // paths in the volume. Recreate only this new event with the real encoder.
      await rm(target, { recursive: true, force: true });
      await rename(preserved, target);
      if (appended) {
        await writeSessionSource(
          fixture.root,
          namespace.id,
          appended.source,
          appended.captureSequence
        );
      }
    }
    if (missing === "event-and-receipt")
      expect(await rebuildSessionSourceReceipts(actor, sessionId)).toEqual({
        restored: 1,
        pending: 0,
      });
    const complete = await PrivateMemoryRepository.backupCorpus(actor);
    expect(complete.sources).toHaveLength(2);
    expect(complete.capturedThrough).toBe(appended?.captureSequence);
    expect((await PrivateMemoryRepository.read(actor)).snapshot.revision).toBe(
      publication.receipt.revision
    );
  }
);

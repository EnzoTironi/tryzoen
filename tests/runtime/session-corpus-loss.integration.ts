import { randomUUID } from "node:crypto";
import { lstat, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import type { HookEvent } from "eve/hooks";
import { workspaceFixture } from "./workspace-fixture";
import { sessionSource } from "../../server/memory/session-files";
import { claimSession } from "../../db/services/sessions";
import {
  captureSessionSource,
  drainSessionSources,
} from "../../server/memory/session-capture";
import { exportSessionSources } from "../../server/memory/session-export";

const { directory } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  return {
    directory: await mkdtemp(path.join(tmpdir(), "zoen-session-corpus-loss-")),
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
const source = (): HookEvent<"message.received"> => ({
  type: "message.received",
  meta: { id: randomUUID(), at: "2026-09-28T12:00:00.000Z" },
  data: {
    message: "Synthetic corpus protection check.",
    sequence: 0,
    turnId: "turn_0",
  },
});

test.each(["corpus", "namespace", "volume"] as const)(
  "a lost accepted session %s retains new queued sources until restoration",
  async (missing) => {
    if (!process.env.ZOEN_AI_MEMORY_BINARY)
      throw new Error(
        "This case requires the qualified native memory executable."
      );
    await using workspace = await workspaceFixture();
    const actor = workspace.personal;
    const sessionId = `session-${randomUUID()}`;
    await claimSession(actor, sessionId);
    await captureSessionSource(actor, sessionSource(source(), sessionId));
    expect(await drainSessionSources()).toEqual({
      stored: 1,
      configured: true,
    });
    const [owner] = await query<{
      id: string;
      initialized: boolean;
      learned: boolean;
    }>(sql`
      SELECT namespace_id AS id, session_memory_initialized AS initialized, learned_memory_initialized AS learned
      FROM workspace_memory_namespace WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    expect(owner?.initialized).toBe(true);
    expect(owner?.learned).toBe(false);
    if (!owner) throw new Error("Expected synthetic owner");
    const next = source();
    await captureSessionSource(actor, sessionSource(next, sessionId));
    const target =
      missing === "volume"
        ? directory
        : join(
            directory,
            owner.id,
            ...(missing === "corpus" ? ["ai-memory"] : [])
          );
    const preserved = `${target}.preserved-${randomUUID()}`;
    await rename(target, preserved);
    try {
      await expect(drainSessionSources()).rejects.toMatchObject({
        errors: [
          expect.objectContaining({
            message:
              "Memory requires both its source files and original index.",
          }),
        ],
      });
      const [queued] = await query<{
        payload: unknown;
        stored: string | null;
      }>(sql`SELECT payload, stored_at AS stored
        FROM memory_session_sources WHERE namespace_id = ${owner.id} AND event_id = ${next.meta.id}`);
      expect(queued?.stored).toBeNull();
      expect(queued?.payload).toMatchObject({ eventId: next.meta.id });
      await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(target, { recursive: true, force: true });
      await rename(preserved, target);
    }
    expect(await drainSessionSources()).toEqual({
      stored: 0,
      configured: true,
    });
    await query(sql`UPDATE memory_session_sources SET available_at = now()
      WHERE namespace_id = ${owner.id} AND stored_at IS NULL`);
    expect(await drainSessionSources()).toEqual({
      stored: 1,
      configured: true,
    });
    expect(await drainSessionSources()).toEqual({
      stored: 0,
      configured: true,
    });
    const exported = await exportSessionSources(
      actor,
      sessionId,
      new AbortController().signal
    );
    expect((await exported.text()).trim().split("\n")).toHaveLength(2);
  }
);

import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  lstat,
  mkdir,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  backupSessionClaimSources,
  rebuildSessionSourceReceipts,
  restoreSessionClaimSources,
  SessionArchiveUnavailable,
} from "./session-export";
import {
  decodeSessionSource,
  encodeSessionSource,
  writeSessionSource,
  type sessionSourceSchema,
} from "./session-files";
import type { z } from "zod";
import { WorkspaceAccessDenied } from "../workspaces/access";

const owner = vi.hoisted(() => ({
  root: vi.fn<() => string | undefined>(),
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  access: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("@shared/environment/env", () => ({
  env: {
    get ZOEN_SESSION_ARCHIVE_DIR() {
      return owner.root();
    },
  },
}));
vi.mock("@db/queries", () => ({
  query: owner.query,
  transaction: async <T>(run: () => Promise<T>) => run(),
}));
vi.mock("../workspaces/access", async (original) => ({
  ...(await original<typeof import("../workspaces/access")>()),
  requireWorkspaceAccess: owner.access,
}));

const actor = {
  workspaceId: "personal-or-team-workspace",
  userId: "source-owner",
  authSessionId: "synthetic-session",
};
const namespace = randomUUID();
const source: z.infer<typeof sessionSourceSchema> = {
  version: 2,
  source: "eve",
  sessionId: "synthetic-owned-session",
  eventId: "synthetic-original-event",
  occurredAt: "2026-10-01T05:00:00.000Z",
  kind: "message.received",
  turnId: null,
  sequence: null,
  stepIndex: null,
  role: "user",
  settlement: null,
  text: "A synthetic personal fact. 🐕",
};
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const citation = {
  kind: "session" as const,
  sessionId: source.sessionId,
  eventId: source.eventId,
  sha256: digest(JSON.stringify(source)),
  excerpt: "synthetic personal fact",
};
const archive = () => ({
  sessionId: source.sessionId,
  eventId: source.eventId,
  captureSequence: 7,
  content: encodeSessionSource(source, 7),
});
let root: string;
let receipt: Record<string, unknown> | null;
let highWater: string | null;
let collisions: Record<string, unknown>[];
let erasure: Record<string, unknown>[];
const compile = (statement: SQL) => new PgDialect().sqlToQuery(statement);
const statements = () =>
  owner.query.mock.calls.map(([statement]) => compile(statement));
const target = (eventId = source.eventId) =>
  join(
    root,
    namespace,
    "raw",
    "eve",
    digest(source.sessionId),
    `${digest(eventId)}.jsonl`
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zoen-session-restore-"));
  owner.root.mockReset().mockReturnValue(root);
  owner.access.mockReset().mockResolvedValue(true);
  receipt = null;
  highWater = "10";
  collisions = [];
  erasure = [];
  owner.query.mockReset().mockImplementation(async (statement) => {
    const { sql } = compile(statement);
    if (sql.includes("JOIN agent_sessions"))
      return [{ namespace_id: namespace }];
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("pg_sequence_last_value"))
      return [{ high_water: highWater }];
    if (sql.includes("FROM workspace_memory_erasure")) return erasure;
    if (sql.includes("WHERE capture_sequence =")) return collisions;
    if (sql.includes("SELECT digest, capture_sequence"))
      return receipt ? [receipt] : [];
    if (sql.includes("INSERT INTO memory_session_sources")) {
      // A receipt cannot be inserted before the immutable file exists.
      await readFile(target());
      receipt = {
        digest: citation.sha256,
        sequence: "7",
        stored_at: "operational-rebuild-time",
      };
      return [];
    }
    throw new Error(`Unexpected source recovery SQL: ${sql}`);
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("canonical multibyte source round-trip preserves exact source metadata and sequence", () => {
  const file = decodeSessionSource(archive().content);
  expect(file.source).toEqual(source);
  expect(file.captureSequence).toBe(7);
  expect(file.digest).toBe(citation.sha256);
  expect(() =>
    decodeSessionSource(Buffer.concat([archive().content, Buffer.from("\n")]))
  ).toThrow(/Invalid session source (segments|coordinates)/u);
  expect(() => decodeSessionSource(Buffer.from("{}\n".repeat(514)))).toThrow(
    "Invalid session source segments."
  );
});

test("authenticated exact source restoration fsyncs bytes before reconstructing the missing receipt", async () => {
  await expect(
    restoreSessionClaimSources(actor, namespace, [citation], [archive()])
  ).resolves.toEqual({ files: 1, receipts: 1 });
  expect(await readFile(target())).toEqual(archive().content);
  expect((await lstat(target())).mode & 0o777).toBe(0o600);
  expect(statements().some((item) => /setval|nextval/u.test(item.sql))).toBe(
    false
  );
  expect(
    statements().find((item) => item.sql.includes("JOIN agent_sessions"))
      ?.params
  ).toEqual([actor.workspaceId, actor.userId, source.sessionId]);
  expect(receipt?.stored_at).toBe("operational-rebuild-time");
  expect(
    statements().find((item) => item.sql.includes("INSERT"))?.params
  ).toEqual([namespace, source.eventId, citation.sha256, 7]);
});

test("exact replay retains immutable bytes and the existing stored receipt", async () => {
  await restoreSessionClaimSources(actor, namespace, [citation], [archive()]);
  const before = await lstat(target());
  owner.query.mockClear();
  await expect(
    restoreSessionClaimSources(actor, namespace, [citation], [archive()])
  ).resolves.toEqual({ files: 1, receipts: 0 });
  expect((await lstat(target())).ino).toBe(before.ino);
  expect(statements().some((item) => item.sql.includes("INSERT"))).toBe(false);
});

for (const state of [
  "pending",
  "digest",
  "sequence",
  "high-water",
  "allocator-lost",
  "collision",
] as const) {
  test(`recovery refuses ${state} before creating any source directory or acknowledging a receipt`, async () => {
    receipt = { digest: citation.sha256, sequence: "7", stored_at: "stored" };
    if (state === "pending") receipt.stored_at = null;
    if (state === "digest") receipt.digest = "f".repeat(64);
    if (state === "sequence") receipt.sequence = "8";
    if (state === "high-water") highWater = "6";
    if (state === "allocator-lost") highWater = null;
    if (state === "collision")
      collisions = [
        { namespace_id: randomUUID(), event_id: "another-owner-event" },
      ];
    await expect(
      restoreSessionClaimSources(actor, namespace, [citation], [archive()])
    ).rejects.toBeInstanceOf(SessionArchiveUnavailable);
    await expect(lstat(join(root, namespace))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      statements().some(
        (item) =>
          item.sql.includes("INSERT") ||
          item.sql.includes("UPDATE memory_session_sources")
      )
    ).toBe(false);
  });
}

for (const state of [
  "bytes",
  "coords",
  "sequence",
  "extra",
  "missing",
  "duplicate",
  "excerpt",
  "unsettled",
] as const) {
  test(`recovery rejects ${state} coverage before accessing SQL/files`, async () => {
    const item = archive();
    let items = [item];
    let citations = [citation];
    if (state === "bytes") item.content = Buffer.from("invalid");
    if (state === "coords") item.sessionId = "another-session";
    if (state === "sequence") item.captureSequence = 8;
    if (state === "extra") citations = [];
    if (state === "missing") items = [];
    if (state === "duplicate") items.push(item);
    if (state === "excerpt")
      citations = [{ ...citation, excerpt: "not in the archive" }];
    if (state === "unsettled") {
      const stream = {
        ...source,
        kind: "message.completed" as const,
        role: "assistant" as const,
        settlement: "unverified" as const,
      };
      item.content = encodeSessionSource(stream, 7);
      citations = [{ ...citation, sha256: digest(JSON.stringify(stream)) }];
    }
    await expect(
      restoreSessionClaimSources(actor, namespace, citations, items)
    ).rejects.toThrow(/saved conversation|JSON|session source/iu);
    expect(owner.query).not.toHaveBeenCalled();
    await expect(lstat(join(root, namespace))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
}

test("current session ownership cannot be reconstructed from authenticated archive bytes", async () => {
  owner.query.mockResolvedValueOnce([]);
  await expect(
    restoreSessionClaimSources(actor, namespace, [citation], [archive()])
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(lstat(join(root, namespace))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("preflight validates all events before writing an earlier valid source", async () => {
  const other = {
    ...source,
    eventId: "synthetic-second-event",
    text: "Another original fact",
  };
  const otherCitation = {
    ...citation,
    eventId: other.eventId,
    sha256: digest(JSON.stringify(other)),
    excerpt: "Another",
  };
  const otherArchive = {
    sessionId: other.sessionId,
    eventId: other.eventId,
    captureSequence: 8,
    content: encodeSessionSource(other, 8),
  };
  await mkdir(dirname(target()), { recursive: true, mode: 0o700 });
  await writeFile(target(other.eventId), "conflicting bytes", { mode: 0o600 });
  await expect(
    restoreSessionClaimSources(
      actor,
      namespace,
      [citation, otherCitation],
      [archive(), otherArchive]
    )
  ).rejects.toThrow("Invalid session source segments.");
  await expect(lstat(target())).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(target(other.eventId), "utf8")).toBe(
    "conflicting bytes"
  );
});

test("symlink destinations and permissive directories refuse restore without overwrite", async () => {
  await mkdir(dirname(target()), { recursive: true, mode: 0o700 });
  const outside = join(root, "outside");
  await writeFile(outside, archive().content, { mode: 0o600 });
  await symlink(outside, target());
  await expect(
    restoreSessionClaimSources(actor, namespace, [citation], [archive()])
  ).rejects.toThrow(/ELOOP|symbolic link/u);
  expect((await lstat(target())).isSymbolicLink()).toBe(true);
  expect(statements().some((item) => item.sql.includes("INSERT"))).toBe(false);
});

test("failed SQL receipt reconstruction leaves replayable immutable bytes, never removes them", async () => {
  const usual = owner.query.getMockImplementation();
  if (!usual) throw new Error("Missing boundary");
  owner.query.mockImplementation(async (statement) => {
    if (compile(statement).sql.includes("INSERT INTO memory_session_sources"))
      throw new Error("Synthetic receipt rollback");
    return usual(statement);
  });
  await expect(
    restoreSessionClaimSources(actor, namespace, [citation], [archive()])
  ).rejects.toThrow("Synthetic receipt rollback");
  expect(await readFile(target())).toEqual(archive().content);
  const before = await lstat(target());
  owner.query.mockImplementation(usual);
  await restoreSessionClaimSources(actor, namespace, [citation], [archive()]);
  expect((await lstat(target())).ino).toBe(before.ino);
});

test("backup includes exact delivered event bytes once for repeated historical citations", async () => {
  await writeSessionSource(root, namespace, source, 7);
  receipt = {
    digest: citation.sha256,
    sequence: "7",
    stored_at: "native-delivered",
  };
  await expect(
    backupSessionClaimSources(actor, namespace, [
      citation,
      { ...citation, excerpt: "personal" },
    ])
  ).resolves.toEqual([archive()]);
  expect(statements().some((item) => item.sql.includes("INSERT"))).toBe(false);
});

test("backup never promotes a pending stream/outbox receipt", async () => {
  await writeSessionSource(root, namespace, source, 7);
  receipt = { digest: citation.sha256, sequence: "7", stored_at: null };
  await expect(
    backupSessionClaimSources(actor, namespace, [citation])
  ).rejects.toBeInstanceOf(SessionArchiveUnavailable);
});

test("standalone receipt rebuild uses the same allocator/collision denial fence and preserves pending delivery", async () => {
  await writeSessionSource(root, namespace, source, 7);
  receipt = { digest: citation.sha256, sequence: "7", stored_at: null };
  await expect(
    rebuildSessionSourceReceipts(actor, source.sessionId)
  ).resolves.toEqual({ restored: 0, pending: 1 });
  expect(
    statements().some((item) => item.sql.includes("pg_sequence_last_value"))
  ).toBe(true);
  expect(
    statements().some(
      (item) =>
        item.sql.includes("INSERT") ||
        item.sql.includes("UPDATE memory_session_sources")
    )
  ).toBe(false);
  highWater = "6";
  await expect(
    rebuildSessionSourceReceipts(actor, source.sessionId)
  ).rejects.toBeInstanceOf(SessionArchiveUnavailable);
});

test("standalone rebuild refuses a retained namespace erasure instead of reconstructing the deleted index", async () => {
  await writeSessionSource(root, namespace, source, 7);
  erasure = [{ namespace_id: namespace }];
  await expect(
    rebuildSessionSourceReceipts(actor, source.sessionId)
  ).rejects.toBeInstanceOf(SessionArchiveUnavailable);
  expect(statements().some((item) => item.sql.includes("INSERT"))).toBe(false);
});

test("two archive events cannot reuse one native allocation even when both receipt indexes are missing", async () => {
  const other = { ...source, eventId: "another-event" };
  await expect(
    restoreSessionClaimSources(
      actor,
      namespace,
      [
        citation,
        {
          ...citation,
          eventId: other.eventId,
          sha256: digest(JSON.stringify(other)),
        },
      ],
      [
        archive(),
        {
          sessionId: other.sessionId,
          eventId: other.eventId,
          captureSequence: 7,
          content: encodeSessionSource(other, 7),
        },
      ]
    )
  ).rejects.toBeInstanceOf(SessionArchiveUnavailable);
  expect(owner.query).not.toHaveBeenCalled();
});

test("known delivered receipt can reconstruct a lost raw file without new publication or receipt", async () => {
  receipt = {
    digest: citation.sha256,
    sequence: "7",
    stored_at: "original-delivery-time",
  };
  await expect(
    restoreSessionClaimSources(actor, namespace, [citation], [archive()])
  ).resolves.toEqual({ files: 1, receipts: 0 });
  expect(await readFile(target())).toEqual(archive().content);
  expect(receipt.stored_at).toBe("original-delivery-time");
  expect(statements().some((item) => item.sql.includes("INSERT"))).toBe(false);
});

test("accepted settled assistant evidence retains its absent source date instead of assigning rebuild time", async () => {
  const settled = {
    ...source,
    kind: "message.settled" as const,
    role: "assistant" as const,
    settlement: "accepted" as const,
    occurredAt: null,
  };
  const item = { ...archive(), content: encodeSessionSource(settled, 7) };
  const fact = { ...citation, sha256: digest(JSON.stringify(settled)) };
  const usual = owner.query.getMockImplementation();
  if (!usual) throw new Error("Missing boundary");
  const observed: {
    params?: unknown[];
    source?: ReturnType<typeof decodeSessionSource>["source"];
  } = {};
  owner.query.mockImplementation(async (statement) => {
    if (compile(statement).sql.includes("INSERT INTO memory_session_sources")) {
      observed.params = compile(statement).params;
      observed.source = decodeSessionSource(await readFile(target())).source;
      return [];
    }
    return usual(statement);
  });
  await restoreSessionClaimSources(actor, namespace, [fact], [item]);
  expect(observed.params).toEqual([namespace, source.eventId, fact.sha256, 7]);
  expect(observed.source?.occurredAt).toBeNull();
});

test("pending exact namespace erasure blocks raw evidence export and recovery before receipt work", async () => {
  await writeSessionSource(root, namespace, source, 7);
  receipt = { digest: citation.sha256, sequence: "7", stored_at: "delivered" };
  erasure = [{ namespace_id: namespace }];
  await expect(
    backupSessionClaimSources(actor, namespace, [citation])
  ).rejects.toBeInstanceOf(SessionArchiveUnavailable);
  await expect(
    restoreSessionClaimSources(actor, namespace, [citation], [archive()])
  ).rejects.toBeInstanceOf(SessionArchiveUnavailable);
  expect(
    statements().some(
      (item) =>
        item.sql.includes("SELECT digest") || item.sql.includes("INSERT")
    )
  ).toBe(false);
  expect(await readFile(target())).toEqual(archive().content);
});

test("recovery reads native high-water/collisions only after the producer's allocation fence releases", async () => {
  const usual = owner.query.getMockImplementation();
  if (!usual) throw new Error("Missing boundary");
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  owner.query.mockImplementation(async (statement) => {
    if (compile(statement).sql.includes("pg_advisory_xact_lock")) {
      entered.resolve();
      await gate.promise;
      return [];
    }
    return usual(statement);
  });
  const pending = restoreSessionClaimSources(
    actor,
    namespace,
    [citation],
    [archive()]
  );
  await entered.promise;
  expect(
    statements().some(
      (item) =>
        item.sql.includes("pg_sequence_last_value") ||
        item.sql.includes("WHERE capture_sequence =")
    )
  ).toBe(false);
  // The simulated native capture becomes visible when its transaction releases
  // the shared lock. This schedule is mocked SQL, not PostgreSQL lock proof.
  highWater = "7";
  collisions = [
    { namespace_id: randomUUID(), event_id: "captured-at-restored-sequence" },
  ];
  gate.resolve();
  await expect(pending).rejects.toBeInstanceOf(SessionArchiveUnavailable);
  expect(statements().some((item) => item.sql.includes("INSERT"))).toBe(false);
  await expect(lstat(join(root, namespace))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

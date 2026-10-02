import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import { env } from "@shared/environment/env";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  decodeSessionSource,
  sessionArchiveLimits,
  type SessionSourceBackupSchema,
  writeSessionSource,
} from "./session-files";
import { LearnedClaimSessionSourceSchema } from "../../packages/companion-ui/src/learned/claim";
import { memoryNamespace, requireMemoryNamespaceAvailable } from "./namespace";
import { operationSignal, withDeadline, withSignal } from "../operations/async";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const fileLimit = sessionArchiveLimits.fileBytes;
const exportLimit = sessionArchiveLimits.bytes;
const noAbortListener = () => undefined;

export class SessionArchiveUnavailable extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "No saved conversation archive is available yet. Try again after the conversation has been saved.",
      options
    );
  }
}

async function archiveNamespace(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string,
  lockNamespace = false
) {
  if (
    actor.agentGrantId ||
    actor.protocolTaskId ||
    actor.scheduledRunId ||
    actor.groupBindingId ||
    actor.groupEpoch ||
    actor.matrixIdentityId
  )
    throw new WorkspaceAccessDenied();
  await requireWorkspaceAccess(actor);
  const rows =
    await query(sql`SELECT n.namespace_id FROM workspace_memory_namespace n
    JOIN agent_sessions s ON s.workspace_id = n.workspace_id AND s.created_by_user_id = n.user_id
    WHERE n.workspace_id = ${actor.workspaceId} AND n.user_id = ${actor.userId}
      AND s.session_id = ${sessionId}
      ${lockNamespace ? sql`FOR UPDATE OF n FOR SHARE OF s` : sql`FOR SHARE OF n, s`}`);
  if (!rows[0]) throw new WorkspaceAccessDenied();
  const namespace = z.uuid().parse(rows[0].namespace_id);
  // Recovery may restore a namespace while its non-restored erasure is pending.
  // Never release raw evidence/export or rebuild its index in that state.
  const erasure = await query(
    sql`SELECT namespace_id FROM workspace_memory_erasure WHERE namespace_id = ${namespace}`
  );
  if (erasure.length) throw new SessionArchiveUnavailable();
  return namespace;
}

/** Read one immutable file with a hard allocation bound, even if it grows. */
async function sourceFile(
  path: string,
  sessionId: string | undefined,
  filename: string
) {
  await using file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  ).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      throw new SessionArchiveUnavailable({ cause: error });
    throw error;
  });
  const info = await file.stat();
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > fileLimit)
    throw new Error("The saved conversation archive could not be verified.");
  const bytes = Buffer.alloc(info.size + 1);
  let length = 0;
  while (length < bytes.length) {
    const result = await file.read(bytes, length, bytes.length - length, null);
    if (result.bytesRead === 0) break;
    length += result.bytesRead;
  }
  if (length !== info.size)
    throw new Error("The saved conversation archive changed while reading.");
  const content = bytes.subarray(0, length);
  const decoded = decodeSessionSource(content);
  if (
    (sessionId !== undefined && decoded.source.sessionId !== sessionId) ||
    filename !== `${hash(decoded.source.eventId)}.jsonl`
  )
    throw new Error(
      "The saved conversation archive has invalid source coordinates."
    );
  return decoded;
}

/** Capture a bounded, exact delivered snapshot before returning any bytes. A
 * surviving later append can never hide a missing retained event. */
export async function exportSessionSources(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string,
  signal: AbortSignal
) {
  z.string().min(1).max(256).parse(sessionId);
  const root = env.ZOEN_SESSION_ARCHIVE_DIR;
  if (!root) throw new SessionArchiveUnavailable();
  const deadline = Date.now() + 60_000;
  const captured = await withDeadline(
    () =>
      withSignal(signal, () =>
        transaction(async () => {
          const namespace = await archiveNamespace(actor, sessionId);
          const [inventory] =
            await query(sql`SELECT count(*)::text AS count,max(capture_sequence)::text AS "highWater"
            FROM memory_session_sources WHERE namespace_id=${namespace}`);
          const rows =
            await query(sql`SELECT session_id AS "sessionId",event_id AS "eventId",digest,
            capture_sequence::text AS sequence,stored_at FROM memory_session_sources
            WHERE namespace_id=${namespace} AND session_id=${sessionId}
            ORDER BY capture_sequence LIMIT ${sessionArchiveLimits.events + 1} FOR SHARE`);
          const [checkpoint] =
            await query(sql`SELECT journal_event_count::text AS count,journal_high_water::text AS "highWater"
      FROM workspace_memory_namespace WHERE namespace_id=${namespace}`);
          if (
            !checkpoint ||
            rows.length > sessionArchiveLimits.events ||
            checkpoint.count !== inventory?.count ||
            (checkpoint.highWater ?? null) !== (inventory?.highWater ?? null)
          )
            throw new SessionArchiveUnavailable();
          const expected = rows;
          if (!expected.length || expected.some((row) => !row.stored_at))
            throw new SessionArchiveUnavailable();
          const directory = await sessionDirectory(root, namespace, sessionId);
          const filenames = new Set(
            expected.map(
              (row) => `${hash(z.string().parse(row.eventId))}.jsonl`
            )
          );
          let count = 0;
          for await (const entry of await opendir(directory)) {
            operationSignal().throwIfAborted();
            if (
              ++count > sessionArchiveLimits.events ||
              !entry.isFile() ||
              !filenames.delete(entry.name)
            )
              throw new SessionArchiveUnavailable();
          }
          if (filenames.size) throw new SessionArchiveUnavailable();
          const contents: { eventId: string; content: Buffer }[] = [];
          let bytes = 0;
          for (const receipt of expected) {
            operationSignal().throwIfAborted();
            const file = await deliveredSource(
              namespace,
              sessionId,
              join(
                directory,
                `${hash(z.string().parse(receipt.eventId))}.jsonl`
              )
            );
            if (
              !file ||
              receipt.digest !== file.digest ||
              receipt.sequence !== String(file.captureSequence)
            )
              throw new SessionArchiveUnavailable();
            bytes += file.content.byteLength;
            if (bytes > exportLimit) throw new SessionArchiveUnavailable();
            contents.push({
              eventId: file.source.eventId,
              content: file.content,
            });
          }
          await requireWorkspaceAccess(actor);
          await requireMemoryNamespaceAvailable(namespace);
          return { namespace, contents, bytes };
        })
      ),
    deadline
  );
  const cancellation = new AbortController();
  const combined = AbortSignal.any([signal, cancellation.signal]);
  let activePull: Promise<void> | undefined;
  let removeAbort: () => void = noAbortListener;
  let index = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const abort = () => {
          cancellation.abort(signal.reason);
          if (!activePull) controller.error(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
        removeAbort = () => {
          signal.removeEventListener("abort", abort);
        };
        if (signal.aborted) abort();
      },
      pull(controller) {
        activePull = withDeadline(
          () =>
            withSignal(combined, async () => {
              const entry = captured.contents[index];
              if (!entry) {
                removeAbort();
                controller.close();
                return;
              }
              // Each bounded pull rechecks current identity, generation, receipt and
              // immutable bytes. Prevalidation proves completeness, not future access.
              const fresh = await verifiedSource(
                actor,
                sessionId,
                captured.namespace,
                join(
                  await sessionDirectory(root, captured.namespace, sessionId),
                  `${hash(entry.eventId)}.jsonl`
                )
              );
              combined.throwIfAborted();
              if (!fresh || !fresh.content.equals(entry.content))
                throw new SessionArchiveUnavailable();
              controller.enqueue(entry.content);
              index++;
              if (index === captured.contents.length) {
                removeAbort();
                controller.close();
              }
            }),
          deadline
        ).catch((error: unknown) => {
          removeAbort();
          controller.error(error);
        });
        return activePull.finally(() => {
          activePull = undefined;
        });
      },
      async cancel(reason) {
        cancellation.abort(reason);
        removeAbort();
        await activePull;
      },
    },
    { highWaterMark: 0 }
  );
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-length": String(captured.bytes),
      "content-disposition": `attachment; filename="zoen-conversation-${hash(sessionId).slice(0, 12)}.jsonl"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function sessionDirectory(
  root: string,
  namespace: string,
  sessionId: string
) {
  const parts = [root, namespace, "raw", "eve", hash(sessionId)];
  for (let index = 1; index <= parts.length; index++) {
    const path = join(...parts.slice(0, index));
    const info = await lstat(path).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        throw new SessionArchiveUnavailable({ cause: error });
      throw error;
    });
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0
    )
      throw new Error("The saved conversation archive is not private.");
  }
  return join(...parts);
}

async function verifiedSource(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string,
  namespace: string,
  path: string
) {
  return transaction(async () => {
    if ((await archiveNamespace(actor, sessionId)) !== namespace)
      throw new WorkspaceAccessDenied();
    return deliveredSource(namespace, sessionId, path);
  });
}

async function deliveredSource(
  namespace: string,
  sessionId: string,
  path: string
) {
  const file = await sourceFile(path, sessionId, basename(path));
  const receipt = (
    await query(sql`SELECT session_id AS "sessionId", digest, capture_sequence::text AS sequence, stored_at
          FROM memory_session_sources WHERE namespace_id = ${namespace} AND event_id = ${file.source.eventId} FOR SHARE`)
  )[0];
  if (
    !receipt ||
    receipt.sessionId !== sessionId ||
    receipt.digest !== file.digest ||
    receipt.sequence !== String(file.captureSequence)
  )
    throw new Error(
      "The saved conversation archive does not match its receipt."
    );
  return receipt.stored_at ? file : null;
}

/** Exact immutable source evidence for a private claim. A completed stream block
 * is not an accepted assistant answer. Ownership and delivery receipts are
 * rechecked under the caller's transaction; no citation establishes access. */
export async function verifySessionClaimSource(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof LearnedClaimSessionSourceSchema>
) {
  const citation = LearnedClaimSessionSourceSchema.parse(raw);
  const root = env.ZOEN_SESSION_ARCHIVE_DIR;
  if (!root) throw new SessionArchiveUnavailable();
  try {
    return await transaction(async () => {
      const namespace = await archiveNamespace(actor, citation.sessionId);
      const directory = await sessionDirectory(
        root,
        namespace,
        citation.sessionId
      );
      const file = await verifiedSource(
        actor,
        citation.sessionId,
        namespace,
        join(directory, `${hash(citation.eventId)}.jsonl`)
      );
      if (!file || file.digest !== citation.sha256) return false;
      return sessionClaimMatches(file, citation);
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDenied) throw error;
    throw new SessionArchiveUnavailable();
  }
}

function sessionClaimMatches(
  file: ReturnType<typeof decodeSessionSource>,
  citation: z.infer<typeof LearnedClaimSessionSourceSchema>
) {
  const source = file.source;
  const accepted =
    (source.kind === "message.received" &&
      source.role === "user" &&
      source.settlement === null) ||
    (source.kind === "message.settled" &&
      source.role === "assistant" &&
      source.settlement === "accepted");
  return (
    accepted &&
    source.sessionId === citation.sessionId &&
    source.eventId === citation.eventId &&
    file.digest === citation.sha256 &&
    (source.text?.includes(citation.excerpt) ?? false)
  );
}

/** Export only exact cited events, including retained pre-clear evidence. Current
 * ownership and stored delivery receipts, not citation text, establish access. */
export async function backupSessionClaimSources(
  actor: z.infer<typeof WorkspaceActorSchema>,
  namespace: string,
  citations: readonly z.infer<typeof LearnedClaimSessionSourceSchema>[]
) {
  if (!citations.length) return [];
  const root = env.ZOEN_SESSION_ARCHIVE_DIR;
  if (!root) throw new SessionArchiveUnavailable();
  const files = new Map<string, Awaited<ReturnType<typeof verifiedSource>>>();
  let size = 0;
  for (const citation of citations) {
    let file = files.get(citation.eventId);
    if (!file) {
      if (files.size >= sessionArchiveLimits.events)
        throw new SessionArchiveUnavailable();
      const directory = await sessionDirectory(
        root,
        namespace,
        citation.sessionId
      );
      file = await verifiedSource(
        actor,
        citation.sessionId,
        namespace,
        join(directory, `${hash(citation.eventId)}.jsonl`)
      );
      if (!file) throw new SessionArchiveUnavailable();
      size += file.content.byteLength;
      if (size > exportLimit) throw new SessionArchiveUnavailable();
      files.set(citation.eventId, file);
    }
    if (!sessionClaimMatches(file, citation))
      throw new SessionArchiveUnavailable();
  }
  return [...files.values()]
    .map((file) => {
      if (!file) throw new SessionArchiveUnavailable();
      return {
        sessionId: file.source.sessionId,
        eventId: file.source.eventId,
        captureSequence: file.captureSequence,
        content: Buffer.from(file.content),
      };
    })
    .toSorted((a, b) =>
      a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0
    );
}

/** Enumerate both inventories under the authorized namespace lock. A complete
 * snapshot refuses pending delivery, orphan bytes and missing delivered bytes. */
export async function backupCompleteSessionSources(
  actor: z.infer<typeof WorkspaceActorSchema>,
  namespace: string
) {
  return transaction(async () => {
    if ((await memoryNamespace(actor)).id !== namespace)
      throw new WorkspaceAccessDenied();
    return captureCompleteJournal(namespace, async (sessionId) => {
      if ((await archiveNamespace(actor, sessionId)) !== namespace)
        throw new WorkspaceAccessDenied();
    });
  });
}

async function captureCompleteJournal(
  namespace: string,
  authorizeSession: (sessionId: string) => Promise<void>
) {
  const root = env.ZOEN_SESSION_ARCHIVE_DIR;
  if (!root) throw new SessionArchiveUnavailable();
  const rows =
    await query(sql`SELECT session_id AS "sessionId", event_id AS "eventId", digest, capture_sequence::text AS sequence, stored_at
    FROM memory_session_sources WHERE namespace_id=${namespace}
    ORDER BY capture_sequence LIMIT ${sessionArchiveLimits.events + 1} FOR SHARE`);
  const [checkpoint] =
    await query(sql`SELECT journal_event_count::text AS count, journal_high_water::text AS "highWater"
    FROM workspace_memory_namespace WHERE namespace_id=${namespace}`);
  if (
    !checkpoint ||
    checkpoint.count !== String(rows.length) ||
    (checkpoint.highWater ?? null) !== (rows.at(-1)?.sequence ?? null)
  )
    throw new SessionArchiveUnavailable();
  if (
    rows.length > sessionArchiveLimits.events ||
    rows.some((row) => !row.stored_at)
  )
    throw new SessionArchiveUnavailable();
  const receipts = new Map(
    rows.map((row) => [z.string().parse(row.eventId), row])
  );
  const sources: z.infer<typeof SessionSourceBackupSchema>[] = [];
  let bytes = 0;
  let directories = 0;
  const sessionRoot = join(root, namespace, "raw", "eve");
  let exists = true;
  for (const path of [
    root,
    join(root, namespace),
    join(root, namespace, "raw"),
    sessionRoot,
  ]) {
    const info = await lstat(path).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    });
    if (!info) {
      if (path === root) throw new SessionArchiveUnavailable();
      exists = false;
      break;
    }
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0
    )
      throw new SessionArchiveUnavailable();
  }
  if (exists)
    for await (const directory of await opendir(sessionRoot)) {
      operationSignal().throwIfAborted();
      if (
        ++directories > sessionArchiveLimits.events ||
        !/^[a-f0-9]{64}$/u.test(directory.name) ||
        !directory.isDirectory()
      )
        throw new SessionArchiveUnavailable();
      const path = join(sessionRoot, directory.name);
      const info = await lstat(path);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (info.mode & 0o077) !== 0
      )
        throw new SessionArchiveUnavailable();
      for await (const entry of await opendir(path)) {
        operationSignal().throwIfAborted();
        // A staged or unacknowledged file is not a complete delivered checkpoint.
        if (
          sources.length >= sessionArchiveLimits.events ||
          !/^[a-f0-9]{64}\.jsonl$/u.test(entry.name) ||
          !entry.isFile()
        )
          throw new SessionArchiveUnavailable();
        const file = await sourceFile(
          join(path, entry.name),
          undefined,
          entry.name
        );
        if (hash(file.source.sessionId) !== directory.name)
          throw new SessionArchiveUnavailable();
        await authorizeSession(file.source.sessionId);
        const receipt = receipts.get(file.source.eventId);
        if (
          !receipt ||
          receipt.sessionId !== file.source.sessionId ||
          receipt.digest !== file.digest ||
          receipt.sequence !== String(file.captureSequence)
        )
          throw new SessionArchiveUnavailable();
        receipts.delete(file.source.eventId);
        bytes += file.content.byteLength;
        if (bytes > exportLimit) throw new SessionArchiveUnavailable();
        sources.push({
          sessionId: file.source.sessionId,
          eventId: file.source.eventId,
          captureSequence: file.captureSequence,
          content: Buffer.from(file.content),
        });
      }
    }
  if (receipts.size) throw new SessionArchiveUnavailable();
  await requireMemoryNamespaceAvailable(namespace);
  sources.sort((left, right) => left.captureSequence - right.captureSequence);
  return { sources, capturedThrough: sources.at(-1)?.captureSequence ?? null };
}

/** Capture and receipt repair share namespace→allocation lock ordering. Default
 * nextval must commit before recovery can inspect its allocation/collision fence. */
export async function lockSessionSourceAllocation() {
  await query(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('zoen-session-source-allocation', 0))`
  );
}

/** The existing native sequence is a denial fence, never reset from files. */
async function lockSourceReceiptRecovery() {
  await lockSessionSourceAllocation();
  const [row] = await query(
    sql`SELECT pg_sequence_last_value(pg_get_serial_sequence('memory_session_sources', 'capture_sequence')::regclass)::text AS high_water`
  );
  return row?.high_water === null || row?.high_water === undefined
    ? null
    : BigInt(
        z
          .string()
          .regex(/^[0-9]+$/u)
          .parse(row.high_water)
      );
}

async function sourceReceipt(
  namespace: string,
  file: ReturnType<typeof decodeSessionSource>,
  highWater: bigint | null
) {
  if (highWater === null || BigInt(file.captureSequence) > highWater)
    throw new SessionArchiveUnavailable();
  const collisions =
    await query(sql`SELECT namespace_id, event_id FROM memory_session_sources
    WHERE capture_sequence = ${file.captureSequence} AND (namespace_id <> ${namespace} OR event_id <> ${file.source.eventId}) LIMIT 1`);
  if (collisions.length) throw new SessionArchiveUnavailable();
  const [existing] =
    await query(sql`SELECT session_id AS "sessionId", digest, capture_sequence::text AS sequence, stored_at
    FROM memory_session_sources WHERE namespace_id = ${namespace} AND event_id = ${file.source.eventId} FOR UPDATE`);
  if (
    existing &&
    (existing.sessionId !== file.source.sessionId ||
      existing.digest !== file.digest ||
      existing.sequence !== String(file.captureSequence))
  )
    throw new SessionArchiveUnavailable();
  return existing ?? null;
}

/** Authenticated bytes are recoverable, permissions and pending deliveries are not.
 * Preflight the whole set before any write. SQL rollback can leave exact immutable
 * bytes without a receipt; replay repairs that state without deleting/overwriting. */
export async function restoreSessionClaimSources(
  actor: z.infer<typeof WorkspaceActorSchema>,
  namespace: string,
  citations: readonly z.infer<typeof LearnedClaimSessionSourceSchema>[],
  archives: readonly z.infer<typeof SessionSourceBackupSchema>[]
) {
  return restoreSessionSources(actor, namespace, citations, archives, "claims");
}

export async function restoreCompleteSessionSources(
  actor: z.infer<typeof WorkspaceActorSchema>,
  namespace: string,
  citations: readonly z.infer<typeof LearnedClaimSessionSourceSchema>[],
  archives: readonly z.infer<typeof SessionSourceBackupSchema>[]
) {
  return restoreSessionSources(
    actor,
    namespace,
    citations,
    archives,
    "complete-journal"
  );
}

/** Same ownership, collision and file preflight as apply, with no installation. */
export async function inspectSessionSourceArchive(
  actor: z.infer<typeof WorkspaceActorSchema>,
  namespace: string,
  citations: readonly z.infer<typeof LearnedClaimSessionSourceSchema>[],
  archives: readonly z.infer<typeof SessionSourceBackupSchema>[],
  coverage: "claims" | "complete-journal"
) {
  return restoreSessionSources(
    actor,
    namespace,
    citations,
    archives,
    coverage,
    false
  );
}

async function restoreSessionSources(
  actor: z.infer<typeof WorkspaceActorSchema>,
  namespace: string,
  citations: readonly z.infer<typeof LearnedClaimSessionSourceSchema>[],
  archives: readonly z.infer<typeof SessionSourceBackupSchema>[],
  coverage: "claims" | "complete-journal",
  apply = true
) {
  const root = env.ZOEN_SESSION_ARCHIVE_DIR;
  if (archives.length && !root) throw new SessionArchiveUnavailable();
  const files = new Map<string, ReturnType<typeof decodeSessionSource>>();
  const sequences = new Set<number>();
  let size = 0;
  for (const archive of archives) {
    size += archive.content.byteLength;
    if (
      files.size >= sessionArchiveLimits.events ||
      size > exportLimit ||
      files.has(archive.eventId) ||
      sequences.has(archive.captureSequence)
    )
      throw new SessionArchiveUnavailable();
    const file = decodeSessionSource(archive.content);
    if (
      file.source.sessionId !== archive.sessionId ||
      file.source.eventId !== archive.eventId ||
      file.captureSequence !== archive.captureSequence
    )
      throw new SessionArchiveUnavailable();
    files.set(archive.eventId, file);
    sequences.add(archive.captureSequence);
  }
  const cited = new Set<string>();
  for (const citation of citations) {
    const file = files.get(citation.eventId);
    if (!file || !sessionClaimMatches(file, citation))
      throw new SessionArchiveUnavailable();
    cited.add(citation.eventId);
  }
  if (coverage === "claims" && cited.size !== files.size)
    throw new SessionArchiveUnavailable();
  if (!files.size || !root) return { files: 0, receipts: 0 };
  for (const sessionId of new Set(
    [...files.values()].map((file) => file.source.sessionId)
  )) {
    if ((await archiveNamespace(actor, sessionId)) !== namespace)
      throw new WorkspaceAccessDenied();
  }
  const highWater = await lockSourceReceiptRecovery();
  const missing: ReturnType<typeof decodeSessionSource>[] = [];
  // Validate every existing directory without creating missing paths. Reject
  // symlinks/non-private parents even if the leaf happens to be missing.
  for (const file of files.values()) {
    let path = root;
    for (const component of [
      "",
      namespace,
      "raw",
      "eve",
      hash(file.source.sessionId),
    ]) {
      path = join(path, component);
      const info = await lstat(path).catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      });
      if (
        info &&
        (!info.isDirectory() ||
          info.isSymbolicLink() ||
          (info.mode & 0o077) !== 0)
      )
        throw new SessionArchiveUnavailable();
    }
    const target = join(path, `${hash(file.source.eventId)}.jsonl`);
    const exists = await lstat(target).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    });
    if (exists) {
      const local = await sourceFile(
        target,
        file.source.sessionId,
        basename(target)
      );
      if (!local.content.equals(file.content))
        throw new SessionArchiveUnavailable();
    }
    const receipt = await sourceReceipt(namespace, file, highWater);
    if (receipt && !receipt.stored_at) throw new SessionArchiveUnavailable();
    if (!receipt) missing.push(file);
  }
  await requireWorkspaceAccess(actor);
  // Recheck after allocator/receipt waits at the immutable publication boundary.
  await requireMemoryNamespaceAvailable(namespace);
  if (!apply) return { files: files.size, receipts: missing.length };
  for (const file of files.values())
    await writeSessionSource(
      root,
      namespace,
      file.source,
      file.captureSequence
    );
  for (const file of missing)
    await query(sql`INSERT INTO memory_session_sources
    (namespace_id, event_id, session_id, digest, capture_sequence, stored_at)
    VALUES (${namespace}, ${file.source.eventId}, ${file.source.sessionId}, ${file.digest}, ${file.captureSequence}, clock_timestamp())`);
  return { files: files.size, receipts: missing.length };
}

/** Reconstruct only missing receipt indexes from this owner's immutable files.
 * Never acknowledge an existing pending delivery or recreate permissions/session
 * ownership. Rebuild time is operational; it is not a fabricated source date. */
export async function rebuildSessionSourceReceipts(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string
) {
  z.string().min(1).max(256).parse(sessionId);
  const root = env.ZOEN_SESSION_ARCHIVE_DIR;
  if (!root) throw new SessionArchiveUnavailable();
  try {
    return await transaction(async () => {
      const namespace = await archiveNamespace(actor, sessionId, true);
      const directory = await sessionDirectory(root, namespace, sessionId);
      const highWater = await lockSourceReceiptRecovery();
      const erasure = await query(
        sql`SELECT namespace_id FROM workspace_memory_erasure WHERE namespace_id = ${namespace}`
      );
      if (erasure.length) throw new SessionArchiveUnavailable();
      let count = 0;
      let bytes = 0;
      let restored = 0;
      let pending = 0;
      for await (const entry of await opendir(directory)) {
        if (++count > 10_000) throw new SessionArchiveUnavailable();
        if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) continue;
        if (!/^[a-f0-9]{64}\.jsonl$/u.test(entry.name) || !entry.isFile())
          throw new SessionArchiveUnavailable();
        const file = await sourceFile(
          join(directory, entry.name),
          sessionId,
          entry.name
        );
        bytes += file.content.byteLength;
        if (bytes > exportLimit) throw new SessionArchiveUnavailable();
        const existing = await sourceReceipt(namespace, file, highWater);
        if (existing) {
          if (
            existing.digest !== file.digest ||
            existing.sequence !== String(file.captureSequence)
          )
            throw new SessionArchiveUnavailable();
          if (!existing.stored_at) pending++;
        } else {
          await query(sql`INSERT INTO memory_session_sources
            (namespace_id, event_id, session_id, digest, capture_sequence, stored_at)
            VALUES (${namespace}, ${file.source.eventId}, ${file.source.sessionId}, ${file.digest}, ${file.captureSequence}, clock_timestamp())`);
          restored++;
        }
      }
      await requireWorkspaceAccess(actor);
      return { restored, pending };
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessDenied) throw error;
    throw new SessionArchiveUnavailable();
  }
}

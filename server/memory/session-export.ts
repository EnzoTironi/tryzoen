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

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const fileLimit = sessionArchiveLimits.fileBytes;
const exportLimit = sessionArchiveLimits.bytes;

export class SessionArchiveUnavailable extends Error {
  constructor() {
    super(
      "No saved conversation archive is available yet. Try again after the conversation has been saved."
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
async function sourceFile(path: string, sessionId: string, filename: string) {
  await using file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
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
    decoded.source.sessionId !== sessionId ||
    filename !== `${hash(decoded.source.eventId)}.jsonl`
  )
    throw new Error(
      "The saved conversation archive has invalid source coordinates."
    );
  return decoded;
}

export async function exportSessionSources(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string,
  signal: AbortSignal
) {
  z.string().min(1).max(200).parse(sessionId);
  const root = env.ZOEN_SESSION_ARCHIVE_DIR;
  if (!root) throw new SessionArchiveUnavailable();
  const namespace = await transaction(() => archiveNamespace(actor, sessionId));
  const directory = await sessionDirectory(root, namespace, sessionId);
  const iterator = sessionRecords(
    actor,
    sessionId,
    namespace,
    directory,
    signal
  );
  const first = await iterator.next();
  if (first.done) throw new SessionArchiveUnavailable();
  let abort: () => void;
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        abort = () => {
          controller.error(signal.reason);
          void iterator.return().catch((error: unknown) => {
            controller.error(error);
          });
        };
        signal.addEventListener("abort", abort, { once: true });
        controller.enqueue(first.value);
        if (signal.aborted) abort();
      },
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            signal.removeEventListener("abort", abort);
            controller.close();
          } else controller.enqueue(next.value);
        } catch (error) {
          signal.removeEventListener("abort", abort);
          controller.error(error);
        }
      },
      async cancel() {
        signal.removeEventListener("abort", abort);
        await iterator.return();
      },
    },
    { highWaterMark: 0 }
  );
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
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
        throw new SessionArchiveUnavailable();
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

async function* sessionRecords(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string,
  namespace: string,
  directory: string,
  signal: AbortSignal
) {
  let count = 0;
  let size = 0;
  for await (const entry of await opendir(directory)) {
    signal.throwIfAborted();
    if (++count > 10_000)
      throw new Error("This conversation archive exceeds the download limit.");
    if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) continue;
    if (!/^[a-f0-9]{64}\.jsonl$/u.test(entry.name) || !entry.isFile())
      throw new Error(
        "The saved conversation archive contains an unexpected file."
      );
    const content = await verifiedSource(
      actor,
      sessionId,
      namespace,
      join(directory, entry.name)
    );
    if (!content) continue;
    size += content.content.byteLength;
    if (size > exportLimit)
      throw new Error("This conversation archive exceeds the download limit.");
    signal.throwIfAborted();
    yield content.content;
  }
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
    const file = await sourceFile(path, sessionId, basename(path));
    const receipt = (
      await query(sql`SELECT digest, capture_sequence::text AS sequence, stored_at
          FROM memory_session_sources WHERE namespace_id = ${namespace} AND event_id = ${file.source.eventId} FOR SHARE`)
    )[0];
    if (
      !receipt ||
      receipt.digest !== file.digest ||
      receipt.sequence !== String(file.captureSequence)
    )
      throw new Error(
        "The saved conversation archive does not match its receipt."
      );
    return receipt.stored_at ? file : null;
  });
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
    await query(sql`SELECT digest, capture_sequence::text AS sequence, stored_at
    FROM memory_session_sources WHERE namespace_id = ${namespace} AND event_id = ${file.source.eventId} FOR UPDATE`);
  if (
    existing &&
    (existing.digest !== file.digest ||
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
  if (cited.size !== files.size) throw new SessionArchiveUnavailable();
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
  for (const file of files.values())
    await writeSessionSource(
      root,
      namespace,
      file.source,
      file.captureSequence
    );
  for (const file of missing)
    await query(sql`INSERT INTO memory_session_sources
    (namespace_id, event_id, digest, capture_sequence, stored_at)
    VALUES (${namespace}, ${file.source.eventId}, ${file.digest}, ${file.captureSequence}, clock_timestamp())`);
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
            (namespace_id, event_id, digest, capture_sequence, stored_at)
            VALUES (${namespace}, ${file.source.eventId}, ${file.digest}, ${file.captureSequence}, clock_timestamp())`);
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

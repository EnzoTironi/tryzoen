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
import { sessionSourceSchema, sessionSourceSegments } from "./session-files";

const segmentSchema = sessionSourceSchema.extend({
  segment: z.object({
    index: z.int().nonnegative(),
    count: z.int().positive().max(512),
  }),
  captureSequence: z.int().positive().max(Number.MAX_SAFE_INTEGER),
});
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const fileLimit = 8 * 1024 * 1024;
const exportLimit = 128 * 1024 * 1024;

export class SessionArchiveUnavailable extends Error {
  constructor() {
    super(
      "No saved conversation archive is available yet. Try again after the conversation has been saved."
    );
  }
}

async function archiveNamespace(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sessionId: string
) {
  await requireWorkspaceAccess(actor);
  const rows =
    await query(sql`SELECT n.namespace_id FROM workspace_memory_namespace n
    JOIN agent_sessions s ON s.workspace_id = n.workspace_id AND s.created_by_user_id = n.user_id
    WHERE n.workspace_id = ${actor.workspaceId} AND n.user_id = ${actor.userId}
      AND s.session_id = ${sessionId} FOR SHARE OF n, s`);
  if (!rows[0]) throw new WorkspaceAccessDenied();
  return z.uuid().parse(rows[0].namespace_id);
}

/** Read one immutable file with a hard allocation bound, even if it grows. */
async function sourceFile(path: string, sessionId: string, filename: string) {
  await using file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW
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
  const segments = content
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => segmentSchema.parse(JSON.parse(line)));
  const first = segments[0];
  if (
    !first ||
    first.sessionId !== sessionId ||
    filename !== `${hash(first.eventId)}.jsonl` ||
    first.segment.count !== segments.length
  )
    throw new Error(
      "The saved conversation archive has invalid source coordinates."
    );
  const source = sessionSourceSchema.parse({
    ...first,
    text:
      first.text === null
        ? null
        : segments.map((segment) => segment.text).join(""),
  });
  const expected = sessionSourceSegments(source)
    .map(
      (segment) =>
        `${JSON.stringify({ ...segment, captureSequence: first.captureSequence })}\n`
    )
    .join("");
  if (!content.equals(Buffer.from(expected)))
    throw new Error(
      "The saved conversation archive has inconsistent segments."
    );
  return {
    content,
    source,
    captureSequence: first.captureSequence,
    digest: hash(JSON.stringify(source)),
  };
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
    size += content.byteLength;
    if (size > exportLimit)
      throw new Error("This conversation archive exceeds the download limit.");
    signal.throwIfAborted();
    yield content;
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
    return receipt.stored_at ? file.content : null;
  });
}

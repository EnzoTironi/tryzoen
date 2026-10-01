import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { HookEvent } from "eve/hooks";
import type { MemoryTurnCompletedContext } from "eve/memory";
import { redactSensitiveText } from "@shared/observability/redaction";

export const sessionSourceSchema = z.object({
  version: z.literal(2),
  source: z.literal("eve"),
  sessionId: z.string().min(1).max(256),
  eventId: z.string().min(1).max(256),
  occurredAt: z.string().max(32).pipe(z.iso.datetime()).nullable(),
  kind: z.enum([
    "message.received",
    "message.completed",
    "message.settled",
    "turn.completed",
    "turn.cancelled",
    "turn.failed",
  ]),
  turnId: z.string().max(256).nullable(),
  sequence: z.number().int().nonnegative().nullable(),
  stepIndex: z.number().int().nonnegative().nullable(),
  role: z.enum(["user", "assistant"]).nullable(),
  settlement: z.enum(["unverified", "accepted"]).nullable(),
  text: z
    .string()
    .max(1_048_576)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= 1_048_576,
      "Session messages must fit within 1 MiB."
    )
    .nullable(),
});

/** A source transcript is evidence, never an instruction or a confirmed fact. */
export function sessionSource(event: HookEvent, sessionId: string) {
  if (event.type === "message.received" && event.data.kind) return null;
  const message =
    event.type === "message.received" || event.type === "message.completed"
      ? event.data.message
      : null;
  const boundary = ["turn.completed", "turn.cancelled", "turn.failed"].includes(
    event.type
  );
  if (!boundary && message === null) return null;
  const data = "data" in event ? event.data : {};
  return sessionSourceSchema.parse({
    version: 2,
    source: "eve",
    sessionId,
    eventId: event.meta.id,
    occurredAt: event.meta.at,
    kind: event.type,
    turnId: "turnId" in data ? data.turnId : null,
    sequence: "sequence" in data ? data.sequence : null,
    stepIndex: "stepIndex" in data ? data.stepIndex : null,
    role:
      event.type === "message.received"
        ? "user"
        : event.type === "message.completed"
          ? "assistant"
          : null,
    // Eve can emit different completed blocks for retried attempts at the same
    // coordinates. Preserve each event; only accepted history can settle them.
    settlement: event.type === "message.completed" ? "unverified" : null,
    text: message === null ? null : redactSensitiveText(message),
  });
}

/** Eve's memory capture sees settled model history; stream hooks do not. */
export function settledSessionSource(
  context: Pick<
    MemoryTurnCompletedContext,
    "session" | "operationId" | "turn" | "messages"
  >
) {
  const message = context.messages.at(-1);
  if (message?.role !== "assistant") return null;
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  if (!text.trim()) return null;
  return sessionSourceSchema.parse({
    version: 2,
    source: "eve",
    sessionId: context.session.id,
    eventId: `settled:${createHash("sha256").update(context.operationId).digest("hex")}`,
    // This public callback has no source timestamp. Preserve that absence;
    // the outbox capture sequence orders the receipt without inventing a time.
    occurredAt: null,
    kind: "message.settled",
    turnId: context.turn.id,
    sequence: context.turn.sequence,
    stepIndex: null,
    role: "assistant",
    settlement: "accepted",
    text: redactSensitiveText(text),
  });
}

/** Split only after redaction, so credentials crossing a boundary stay redacted. */
export function sessionSourceSegments(
  source: z.infer<typeof sessionSourceSchema>
) {
  const parts: (string | null)[] = [];
  const text = source.text;
  if (text === null || text === "") parts.push(text);
  else {
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + 2048, text.length);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      parts.push(text.slice(start, end));
      start = end;
    }
  }
  const segments = [];
  for (const [index, part] of parts.entries()) {
    segments.push({
      ...source,
      text: part,
      segment: { index, count: parts.length },
    });
  }
  return segments;
}

export const sessionArchiveLimits = {
  fileBytes: 8_388_608,
  bytes: 134_217_728,
  events: 10_000,
} as const;

export const SessionSourceBackupSchema = z.strictObject({
  sessionId: sessionSourceSchema.shape.sessionId,
  eventId: sessionSourceSchema.shape.eventId,
  captureSequence: z.int().positive().max(Number.MAX_SAFE_INTEGER),
  content: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength <= sessionArchiveLimits.fileBytes),
});

const segmentSchema = sessionSourceSchema.extend({
  segment: z.object({
    index: z.int().nonnegative(),
    count: z.int().positive().max(512),
  }),
  captureSequence: SessionSourceBackupSchema.shape.captureSequence,
});

/** One canonical encoder owns persisted files and authenticated recovery bytes. */
export function encodeSessionSource(
  source: z.infer<typeof sessionSourceSchema>,
  captureSequence: number
) {
  const parsed = sessionSourceSchema.parse(source);
  const sequence =
    SessionSourceBackupSchema.shape.captureSequence.parse(captureSequence);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for (const segment of sessionSourceSegments(parsed)) {
    // Metadata is bounded before segmentation. Check each bounded serialized
    // line before retaining it, so escaping cannot amplify a malformed source
    // into an oversized concatenation or final allocation.
    const chunk = Buffer.from(
      `${JSON.stringify({ ...segment, captureSequence: sequence })}\n`,
      "utf8"
    );
    bytes += chunk.byteLength;
    if (bytes > sessionArchiveLimits.fileBytes)
      throw new Error("Session source exceeds the archive limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

/** Bound line count before JSON parsing; exact re-encoding detects every coordinate,
 * UTF-8, segment, whitespace and sequence mismatch without trusting prose. */
export function decodeSessionSource(content: Uint8Array) {
  if (content.byteLength > sessionArchiveLimits.fileBytes)
    throw new Error("Session source exceeds the archive limit.");
  const bytes = Buffer.from(
    content.buffer,
    content.byteOffset,
    content.byteLength
  );
  const lines = bytes.toString("utf8").split("\n", 514);
  if (lines.length > 513 || lines.at(-1) !== "")
    throw new Error("Invalid session source segments.");
  lines.pop();
  if (lines.some((line) => line.length === 0))
    throw new Error("Invalid session source segments.");
  const segments = lines.map((line) => segmentSchema.parse(JSON.parse(line)));
  const first = segments[0];
  if (!first || first.segment.count !== segments.length)
    throw new Error("Invalid session source coordinates.");
  const source = sessionSourceSchema.parse({
    ...first,
    text:
      first.text === null
        ? null
        : segments.map((segment) => segment.text).join(""),
  });
  if (!bytes.equals(encodeSessionSource(source, first.captureSequence)))
    throw new Error("Inconsistent session source bytes.");
  return {
    content: bytes,
    source,
    captureSequence: first.captureSequence,
    digest: digest(JSON.stringify(source)),
  };
}

export async function privateMemoryDirectory(path: string) {
  const created = await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error(
      "Session archive requires a private directory, without symlinks."
    );
  if (created) {
    await using parent = await open(dirname(path), "r");
    await parent.sync();
  }
}

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Immutable per-event JSONL. A repeated event must match its existing content. */
export async function writeSessionSource(
  root: string,
  namespaceId: string,
  source: z.infer<typeof sessionSourceSchema>,
  captureSequence: number
) {
  const namespace = z.uuid().parse(namespaceId);
  source = sessionSourceSchema.parse(source);
  const content = encodeSessionSource(source, captureSequence);
  await privateMemoryDirectory(root);
  const owner = join(root, namespace);
  await privateMemoryDirectory(owner);
  const raw = join(owner, "raw");
  await privateMemoryDirectory(raw);
  const eve = join(raw, "eve");
  await privateMemoryDirectory(eve);
  const session = join(eve, digest(source.sessionId));
  await privateMemoryDirectory(session);
  const path = join(session, `${digest(source.eventId)}.jsonl`);
  const temporary = join(session, `.${randomUUID()}.tmp`);
  try {
    await using file = await open(temporary, "wx", 0o600);
    await file.writeFile(content);
    await file.sync();
    try {
      await link(temporary, path);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      )
        throw error;
      try {
        await using existing = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        );
        const info = await existing.stat();
        const expected = content;
        if (
          !info.isFile() ||
          (info.mode & 0o077) !== 0 ||
          info.size !== expected.byteLength
        )
          throw new Error("Invalid immutable source file", { cause: error });
        // One extra byte detects growth after stat without reading an unbounded
        // pre-existing file. Match exact bytes, not a lossy UTF-8 decoding.
        const bytes = Buffer.alloc(expected.byteLength + 1);
        let length = 0;
        while (length < bytes.byteLength) {
          const result = await existing.read(
            bytes,
            length,
            bytes.byteLength - length,
            null
          );
          if (result.bytesRead === 0) break;
          length += result.bytesRead;
        }
        if (!expected.equals(bytes.subarray(0, length)))
          throw new Error("Conflicting immutable source bytes", {
            cause: error,
          });
      } catch (cause) {
        throw new Error(
          "Session archive event conflicts with the stored source.",
          { cause }
        );
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
  const directory = await open(session, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  return path;
}

/** The caller must hold the namespace's erasure receipt or authorization lock. */
export async function eraseSessionSources(root: string, namespaceId: string) {
  const namespace = z.uuid().parse(namespaceId);
  await erasePrivateSubtree(root, [namespace, "raw", "eve"]);
  await erasePrivateSubtree(root, [namespace, "ai-memory"]);
  await erasePrivateSubtree(root, [namespace, "learned-memory"]);
  await erasePrivateSubtree(root, [namespace, "creator-knowledge"]);
}

async function erasePrivateSubtree(root: string, components: string[]) {
  let path = root;
  for (const component of ["", ...components]) {
    path = join(path, component);
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Invalid session archive directory.");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
  }
  await rm(path, { recursive: true, force: true });
}

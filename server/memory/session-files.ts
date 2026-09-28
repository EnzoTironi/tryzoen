import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { HookEvent } from "eve/hooks";
import { parseDiagnostic } from "@shared/observability/redaction";

export const sessionSourceSchema = z.object({
  version: z.literal(1),
  source: z.literal("eve"),
  sessionId: z.string().min(1).max(256),
  eventId: z.string().min(1).max(256),
  occurredAt: z.iso.datetime(),
  kind: z.enum([
    "message.received",
    "message.completed",
    "turn.completed",
    "turn.cancelled",
    "turn.failed",
  ]),
  turnId: z.string().nullable(),
  sequence: z.number().int().nonnegative().nullable(),
  stepIndex: z.number().int().nonnegative().nullable(),
  role: z.enum(["user", "assistant"]).nullable(),
  settlement: z.literal("unverified").nullable(),
  text: z.string().max(64_000).nullable(),
  truncated: z.boolean(),
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
    version: 1,
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
    text:
      message === null
        ? null
        : z.string().parse(parseDiagnostic(JSON.stringify(message))),
    truncated: message !== null && message.length > 64_000,
  });
}

async function privateDirectory(path: string) {
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
  const sequence = z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .parse(captureSequence);
  await privateDirectory(root);
  const owner = join(root, namespace);
  await privateDirectory(owner);
  const raw = join(owner, "raw");
  await privateDirectory(raw);
  const eve = join(raw, "eve");
  await privateDirectory(eve);
  const session = join(eve, digest(source.sessionId));
  await privateDirectory(session);
  const path = join(session, `${digest(source.eventId)}.jsonl`);
  const content = `${JSON.stringify({ ...source, captureSequence: sequence })}\n`;
  const temporary = join(session, `.${randomUUID()}.tmp`);
  try {
    await using file = await open(temporary, "wx", 0o600);
    await file.writeFile(content, "utf8");
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
      const info = await lstat(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        (info.mode & 0o077) !== 0 ||
        (await readFile(path, "utf8")) !== content
      )
        throw new Error(
          "Session archive event conflicts with the stored source.",
          { cause: error }
        );
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
  let path = root;
  for (const component of ["", namespace, "raw", "eve"]) {
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

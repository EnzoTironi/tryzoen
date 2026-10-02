import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@shared/environment/env";
import { GitRevisionSchema } from "../../packages/companion-ui/src/library/files-schema";
import { LearnedClaimScopeSchema } from "../../packages/companion-ui/src/learned/claim";
import { privateMemoryArchiveLimits } from "../../packages/companion-ui/src/learned/archive";
import { SessionSourceBackupSchema } from "./session-files";

export class PrivateMemoryArchiveError extends Error {
  readonly _tag = "PrivateMemoryArchiveError";
  constructor(readonly reason: "invalid_input" | "unavailable") {
    super("PrivateMemoryArchiveError");
    this.name = "PrivateMemoryArchiveError";
  }
}

const sources = z.preprocess(
  (raw) => {
    if (!Array.isArray(raw) || raw.length > privateMemoryArchiveLimits.events)
      return null;
    let bytes = 0;
    const entries: readonly unknown[] = raw;
    for (const source of entries) {
      if (
        typeof source !== "object" ||
        source === null ||
        !("content" in source) ||
        !(source.content instanceof Uint8Array)
      )
        return null;
      bytes += source.content.byteLength;
      if (
        source.content.byteLength >
          privateMemoryArchiveLimits.sourceFileBytes ||
        bytes > privateMemoryArchiveLimits.sourceBytes
      )
        return null;
    }
    return entries;
  },
  z
    .array(SessionSourceBackupSchema)
    .max(privateMemoryArchiveLimits.events)
    .refine(
      (items) =>
        new Set(items.map((item) => item.eventId)).size === items.length &&
        new Set(items.map((item) => item.captureSequence)).size ===
          items.length,
      "Archive event identities and capture sequences must be unique"
    )
);
const archive = {
  namespaceId: z.uuid(),
  scope: LearnedClaimScopeSchema,
  revision: GitRevisionSchema.nullable(),
  bundle: z
    .instanceof(Uint8Array)
    .refine(
      (bytes) =>
        bytes.byteLength > 0 &&
        bytes.byteLength <= privateMemoryArchiveLimits.bundleBytes
    )
    .nullable(),
  sources,
  integrity: z.string().regex(/^[a-f0-9]{64}$/),
};
const pairedHead = (value: {
  revision: string | null;
  bundle: Uint8Array | null;
}) => (value.revision === null) === (value.bundle === null);

/** Version 2 covers retained claim lineage and exactly its cited session events. */
export const PrivateMemoryBackupSchema = z
  .strictObject({ version: z.literal(2), ...archive })
  .refine(pairedHead, "Archive revision and bundle must agree");
/** Version 3 also covers every delivered event in one consistent namespace capture. */
export const PrivateMemoryCorpusBackupSchema = z
  .strictObject({
    version: z.literal(3),
    coverage: z.literal("complete-journal"),
    capturedThrough: SessionSourceBackupSchema.shape.captureSequence.nullable(),
    ...archive,
  })
  .refine(pairedHead, "Archive revision and bundle must agree")
  .refine(
    (value) =>
      value.capturedThrough ===
      (value.sources.length
        ? Math.max(...value.sources.map((source) => source.captureSequence))
        : null),
    "Complete journal coverage must match its capture checkpoint"
  );
export const PrivateMemoryArchiveSchema = z.union([
  PrivateMemoryBackupSchema,
  PrivateMemoryCorpusBackupSchema,
]);

export function privateMemoryArchiveDigest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function archiveIntegrity(
  value:
    | Omit<z.infer<typeof PrivateMemoryBackupSchema>, "integrity">
    | Omit<z.infer<typeof PrivateMemoryCorpusBackupSchema>, "integrity">
) {
  const key = env.SECRET_ENCRYPTION_KEY;
  if (!key) throw new PrivateMemoryArchiveError("unavailable");
  return createHmac("sha256", Buffer.from(key, "base64"))
    .update(
      JSON.stringify([
        value.version === 2
          ? "zoen-private-memory-backup-v2"
          : "zoen-private-memory-corpus-v3",
        value.version,
        ...(value.version === 3 ? [value.coverage, value.capturedThrough] : []),
        value.namespaceId,
        value.scope.workspaceId,
        value.scope.userId,
        value.revision,
        value.bundle === null ? null : privateMemoryArchiveDigest(value.bundle),
        value.sources.map((source) => [
          source.sessionId,
          source.eventId,
          source.captureSequence,
          privateMemoryArchiveDigest(source.content),
        ]),
      ])
    )
    .digest("hex");
}

export function sealPrivateMemoryArchive(
  value:
    | Omit<z.infer<typeof PrivateMemoryBackupSchema>, "integrity">
    | Omit<z.infer<typeof PrivateMemoryCorpusBackupSchema>, "integrity">
) {
  return PrivateMemoryArchiveSchema.parse({
    ...value,
    integrity: archiveIntegrity(value),
  });
}

export function requirePrivateMemoryArchiveAuthentication(
  value: z.infer<typeof PrivateMemoryArchiveSchema>
) {
  if (
    !timingSafeEqual(
      Buffer.from(value.integrity, "hex"),
      Buffer.from(archiveIntegrity(value), "hex")
    )
  )
    throw new PrivateMemoryArchiveError("invalid_input");
}

/** Freeze validated caller-owned payloads before the first asynchronous boundary. */
export function copyPrivateMemoryArchive(raw: unknown) {
  const parsed = PrivateMemoryArchiveSchema.parse(raw);
  return {
    ...parsed,
    bundle: parsed.bundle === null ? null : Uint8Array.from(parsed.bundle),
    sources: parsed.sources.map((source) =>
      Object.assign({}, source, {
        content: Uint8Array.from(source.content),
      })
    ),
  };
}

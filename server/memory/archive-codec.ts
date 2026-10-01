import { z } from "zod";
import { privateMemoryArchiveLimits } from "../../packages/companion-ui/src/learned/archive";
import { GitRevisionSchema } from "../../packages/companion-ui/src/library/files-schema";
import { LearnedClaimScopeSchema } from "../../packages/companion-ui/src/learned/claim";
import { SessionSourceBackupSchema } from "./session-files";
import {
  PrivateMemoryArchiveSchema,
  PrivateMemoryArchiveError,
  privateMemoryArchiveDigest,
} from "./archive";

const magic = Buffer.from("ZOENMEMORY\0\x01", "ascii");
const headerBytes = magic.byteLength + 4;
const descriptor = z.strictObject({
  bytes: z.int().positive().max(privateMemoryArchiveLimits.bundleBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const sourceDescriptor = descriptor
  .extend({
    bytes: z.int().positive().max(privateMemoryArchiveLimits.sourceFileBytes),
    sessionId: SessionSourceBackupSchema.shape.sessionId,
    eventId: SessionSourceBackupSchema.shape.eventId,
    captureSequence: SessionSourceBackupSchema.shape.captureSequence,
  })
  .strict();
const manifest = {
  namespaceId: z.uuid(),
  scope: LearnedClaimScopeSchema,
  revision: GitRevisionSchema.nullable(),
  bundle: descriptor.nullable(),
  sources: z.array(sourceDescriptor).max(privateMemoryArchiveLimits.events),
  integrity: z.string().regex(/^[a-f0-9]{64}$/),
};
const manifestSchema = z.discriminatedUnion("version", [
  z.strictObject({
    ...manifest,
    version: z.literal(2),
    coverage: z.literal("claims"),
  }),
  z.strictObject({
    ...manifest,
    version: z.literal(3),
    coverage: z.literal("complete-journal"),
    capturedThrough: SessionSourceBackupSchema.shape.captureSequence.nullable(),
  }),
]);
const invalid = (): never => {
  throw new PrivateMemoryArchiveError("invalid_input");
};

/** No compressed payloads or caller-selected paths. Every size is checked before
 * copying source bytes, and exact total length rejects trailing or missing data. */
export function encodePrivateMemoryArchive(
  raw: z.infer<typeof PrivateMemoryArchiveSchema>
) {
  const archive = PrivateMemoryArchiveSchema.parse(raw);
  const metadata = manifestSchema.parse({
    ...archive,
    coverage: archive.version === 2 ? "claims" : archive.coverage,
    bundle:
      archive.bundle === null
        ? null
        : {
            bytes: archive.bundle.byteLength,
            sha256: privateMemoryArchiveDigest(archive.bundle),
          },
    sources: archive.sources.map(({ content, ...source }) => ({
      ...source,
      bytes: content.byteLength,
      sha256: privateMemoryArchiveDigest(content),
    })),
  });
  const json = Buffer.from(JSON.stringify(metadata), "utf8");
  const total =
    headerBytes +
    json.byteLength +
    (archive.bundle?.byteLength ?? 0) +
    archive.sources.reduce(
      (bytes, source) => bytes + source.content.byteLength,
      0
    );
  if (
    json.byteLength > privateMemoryArchiveLimits.manifestBytes ||
    total > privateMemoryArchiveLimits.wireBytes
  )
    return invalid();
  const result = Buffer.alloc(total);
  magic.copy(result);
  result.writeUInt32BE(json.byteLength, magic.byteLength);
  let offset = headerBytes;
  json.copy(result, offset);
  offset += json.byteLength;
  for (const bytes of [
    archive.bundle,
    ...archive.sources.map((source) => source.content),
  ]) {
    if (bytes === null) continue;
    result.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return result;
}

export function decodePrivateMemoryArchive(raw: Uint8Array) {
  if (
    raw.byteLength < headerBytes ||
    raw.byteLength > privateMemoryArchiveLimits.wireBytes
  )
    return invalid();
  const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (!bytes.subarray(0, magic.byteLength).equals(magic)) return invalid();
  const manifestBytes = bytes.readUInt32BE(magic.byteLength);
  if (
    manifestBytes === 0 ||
    manifestBytes > privateMemoryArchiveLimits.manifestBytes ||
    headerBytes + manifestBytes > bytes.byteLength
  )
    return invalid();
  let json: unknown;
  try {
    json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(headerBytes, headerBytes + manifestBytes)
      )
    );
  } catch {
    return invalid();
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) return invalid();
  const metadata = parsed.data;
  const canonical = Buffer.from(JSON.stringify(metadata), "utf8");
  if (
    !canonical.equals(bytes.subarray(headerBytes, headerBytes + manifestBytes))
  )
    return invalid();
  const eventIds = new Set<string>();
  const sequences = new Set<number>();
  let sourceBytes = 0;
  for (const source of metadata.sources) {
    if (eventIds.has(source.eventId) || sequences.has(source.captureSequence))
      return invalid();
    eventIds.add(source.eventId);
    sequences.add(source.captureSequence);
    sourceBytes += source.bytes;
    if (sourceBytes > privateMemoryArchiveLimits.sourceBytes) return invalid();
  }
  const total =
    headerBytes + manifestBytes + (metadata.bundle?.bytes ?? 0) + sourceBytes;
  if (total !== bytes.byteLength) return invalid();
  let offset = headerBytes + manifestBytes;
  const payload = (entry: z.infer<typeof descriptor>) => {
    const content = bytes.subarray(offset, offset + entry.bytes);
    offset += entry.bytes;
    if (privateMemoryArchiveDigest(content) !== entry.sha256) return invalid();
    return Uint8Array.from(content);
  };
  const bundle = metadata.bundle === null ? null : payload(metadata.bundle);
  const sources = metadata.sources.map((source) => ({
    sessionId: source.sessionId,
    eventId: source.eventId,
    captureSequence: source.captureSequence,
    content: payload(source),
  }));
  const common = {
    namespaceId: metadata.namespaceId,
    scope: metadata.scope,
    revision: metadata.revision,
    integrity: metadata.integrity,
    bundle,
    sources,
  };
  const result = PrivateMemoryArchiveSchema.safeParse(
    metadata.version === 2
      ? { ...common, version: 2 }
      : {
          ...common,
          version: 3,
          coverage: metadata.coverage,
          capturedThrough: metadata.capturedThrough,
        }
  );
  if (!result.success) return invalid();
  return result.data;
}

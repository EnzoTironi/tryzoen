import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { z } from "zod";
import {
  encodePrivateMemoryArchive,
  decodePrivateMemoryArchive,
} from "./archive-codec";
import {
  sealPrivateMemoryArchive,
  requirePrivateMemoryArchiveAuthentication,
  copyPrivateMemoryArchive,
  PrivateMemoryArchiveError,
  PrivateMemoryBackupSchema,
  PrivateMemoryCorpusBackupSchema,
} from "./archive";
import { encodeSessionSource, sessionSourceSchema } from "./session-files";
import { publishPrivateMemoryGit } from "./git";
import { privateMemoryArchiveLimits } from "../../packages/companion-ui/src/learned/archive";

async function archiveFixture() {
  const scope = {
    workspaceId: "codec-private-workspace",
    userId: "codec-owner",
  };
  const source = sessionSourceSchema.parse({
    version: 2,
    source: "eve",
    sessionId: "codec-session",
    eventId: "codec-user-event",
    occurredAt: "2026-10-01T00:00:00.000Z",
    kind: "message.received",
    turnId: "codec-turn",
    sequence: 0,
    stepIndex: null,
    role: "user",
    settlement: null,
    text: "A user asks for weekly Cedar reports",
  });
  const captured = {
    sessionId: source.sessionId,
    eventId: source.eventId,
    captureSequence: 7,
    content: encodeSessionSource(source, 7),
  };
  const publication = await publishPrivateMemoryGit({
    scope,
    bundle: null,
    head: null,
    change: {
      action: "assert",
      claimId: randomUUID(),
      operationId: "codec-publication",
      expectedRevision: null,
      body: {
        text: "Weekly Cedar reports",
        relations: [],
        validTime: null,
        sources: [
          {
            kind: "session",
            sessionId: source.sessionId,
            eventId: source.eventId,
            sha256: createHash("sha256")
              .update(JSON.stringify(source))
              .digest("hex"),
            excerpt: "weekly Cedar reports",
          },
        ],
      },
    },
    publication: async () => ({
      authorUserId: scope.userId,
      recordedAt: "2026-10-01T00:00:00.000001Z",
    }),
  });
  if (!publication.applied || !("claim" in publication))
    throw new Error("Expected real Git publication");
  const common = {
    namespaceId: randomUUID(),
    scope,
    revision: publication.receipt.revision,
    bundle: publication.bundle,
    sources: [captured],
  };
  return {
    common,
    claims: PrivateMemoryBackupSchema.parse(
      sealPrivateMemoryArchive({ ...common, version: 2 })
    ),
    corpus: PrivateMemoryCorpusBackupSchema.parse(
      sealPrivateMemoryArchive({
        ...common,
        version: 3,
        coverage: "complete-journal",
        capturedThrough: 7,
      })
    ),
  };
}

function replaceManifest(
  bytes: Uint8Array,
  change: (value: Record<string, unknown>) => Record<string, unknown>
) {
  const original = Buffer.from(bytes);
  // This is the public framed wire header: 12-byte magic and uint32 manifest size.
  const size = original.readUInt32BE(12);
  const raw: unknown = JSON.parse(
    original.subarray(16, 16 + size).toString("utf8")
  );
  const metadata = Buffer.from(
    JSON.stringify(change(z.record(z.string(), z.unknown()).parse(raw)))
  );
  const header = Buffer.from(original.subarray(0, 16));
  header.writeUInt32BE(metadata.byteLength, 12);
  return Buffer.concat([header, metadata, original.subarray(16 + size)]);
}

test("the real Git bundle and exact JSONL bytes round-trip through distinct v2 and v3 wire objects", async () => {
  const { claims, corpus } = await archiveFixture();
  for (const original of [claims, corpus]) {
    const decoded = decodePrivateMemoryArchive(
      encodePrivateMemoryArchive(original)
    );
    expect(decoded).toEqual(copyPrivateMemoryArchive(original));
    expect(() => {
      requirePrivateMemoryArchiveAuthentication(decoded);
    }).not.toThrow();
  }
  expect(
    decodePrivateMemoryArchive(encodePrivateMemoryArchive(claims)).version
  ).toBe(2);
  expect(
    decodePrivateMemoryArchive(encodePrivateMemoryArchive(corpus)).version
  ).toBe(3);
});

test("the wire decoder rejects altered content, truncated frames, trailing bytes and old archives", async () => {
  const { corpus } = await archiveFixture();
  const wire = encodePrivateMemoryArchive(corpus);
  const corrupted = Buffer.from(wire);
  const last = corrupted.length - 1;
  corrupted[last] = (corrupted[last] ?? 0) ^ 1;
  for (const invalid of [
    corrupted,
    wire.subarray(0, wire.length - 1),
    Buffer.concat([wire, Buffer.from([0])]),
    Buffer.from("PK\x03\x04old-native-archive"),
    replaceManifest(wire, (manifest) => ({ ...manifest, version: 1 })),
  ])
    expect(() => decodePrivateMemoryArchive(invalid)).toThrow(
      PrivateMemoryArchiveError
    );
});

test("declared byte, entry and duplicate-coordinate budgets fail before payload copying", async () => {
  const { corpus } = await archiveFixture();
  const wire = encodePrivateMemoryArchive(corpus);
  const tooLargeManifest = Buffer.from(wire.subarray(0, 16));
  tooLargeManifest.writeUInt32BE(
    privateMemoryArchiveLimits.manifestBytes + 1,
    12
  );
  expect(() => decodePrivateMemoryArchive(tooLargeManifest)).toThrow(
    PrivateMemoryArchiveError
  );
  const tooLargeEvent = replaceManifest(wire, (manifest) => ({
    ...manifest,
    sources: z
      .array(z.record(z.string(), z.unknown()))
      .parse(manifest.sources)
      .map((source) =>
        Object.assign({}, source, {
          bytes: privateMemoryArchiveLimits.sourceFileBytes + 1,
        })
      ),
  }));
  expect(() => decodePrivateMemoryArchive(tooLargeEvent)).toThrow(
    PrivateMemoryArchiveError
  );
  const duplicate = replaceManifest(wire, (manifest) => {
    const sources = z
      .array(z.record(z.string(), z.unknown()))
      .parse(manifest.sources);
    return { ...manifest, sources: [...sources, ...sources] };
  });
  const source = corpus.sources[0];
  if (!source) throw new Error("Expected exact source bytes");
  expect(() =>
    decodePrivateMemoryArchive(Buffer.concat([duplicate, source.content]))
  ).toThrow(PrivateMemoryArchiveError);
});

test("archive authentication binds scope, generation, checkpoint and exact payload bytes", async () => {
  const { corpus } = await archiveFixture();
  for (const changed of [
    { ...corpus, scope: { ...corpus.scope, userId: "other" } },
    { ...corpus, namespaceId: randomUUID() },
    { ...corpus, capturedThrough: 8 },
  ])
    expect(() => {
      requirePrivateMemoryArchiveAuthentication(changed);
    }).toThrow(PrivateMemoryArchiveError);
  expect(
    PrivateMemoryCorpusBackupSchema.safeParse({ ...corpus, capturedThrough: 8 })
      .success
  ).toBe(false);
});

test("caller mutation cannot change the copied archive handed to asynchronous recovery", async () => {
  const { claims } = await archiveFixture();
  const source = claims.sources[0];
  if (!source) throw new Error("Expected source");
  const original = Uint8Array.from(source.content);
  const copied = copyPrivateMemoryArchive(claims);
  source.content.fill(0);
  expect(copied.sources[0]?.content).toEqual(original);
  expect(() => {
    requirePrivateMemoryArchiveAuthentication(copied);
  }).not.toThrow();
});

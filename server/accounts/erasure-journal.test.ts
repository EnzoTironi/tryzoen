import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, test, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  send: vi.fn<(command: unknown, options?: unknown) => Promise<unknown>>(),
  destroy: vi.fn<() => void>(),
  created: vi.fn<() => void>(),
}));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...(await original<typeof import("@aws-sdk/client-s3")>()),
  S3Client: class {
    constructor() {
      sdk.created();
    }
    send = sdk.send;
    destroy = sdk.destroy;
  },
}));
vi.mock("@shared/environment/env/erasure-journal", () => ({
  erasureJournalEnvironment: () => ({
    ZOEN_ERASURE_JOURNAL_BUCKET: "synthetic-erasure-bucket",
    ZOEN_ERASURE_JOURNAL_ENDPOINT: "https://journal.synthetic.invalid",
    ZOEN_ERASURE_JOURNAL_ACCESS_KEY: { reveal: () => "synthetic-access-key" },
    ZOEN_ERASURE_JOURNAL_SECRET_KEY: { reveal: () => "synthetic-secret-key" },
  }),
}));
// Keep the real departure schema without loading SQL/provider dependencies.
vi.mock("@db/queries", () => ({
  query() {
    throw new Error("SQL is forbidden in journal transport tests");
  },
}));
vi.mock("../matrix/authority", () => ({
  lockMatrixOrganizations() {
    throw new Error("SQL is forbidden in journal transport tests");
  },
  lockMatrixRoomFences() {
    throw new Error("SQL is forbidden in journal transport tests");
  },
}));

import { ErasureJournal } from "./erasure-journal";

const userId = "better-auth:synthetic-erasure-user";
const matrixA = "@synthetic-a:synthetic.invalid";
const matrixB = "@synthetic-b:synthetic.invalid";
const reference = {
  bindingId: "10000000-0000-4000-8000-000000000001",
  matrixId: matrixA,
  roomId: "!synthetic-room:synthetic.invalid",
  installationId: "synthetic.invalid",
  workspaceId: "synthetic-workspace",
  organizationId: "synthetic-organization",
} satisfies Parameters<typeof ErasureJournal.append>[0]["departures"][number];
const objects = new Map<string, string>();

function objectBody(text: string, contentLength = Buffer.byteLength(text)) {
  return {
    ContentLength: contentLength,
    Body: {
      transformToWebStream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from(text));
            controller.close();
          },
        }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  objects.clear();
  sdk.send.mockReset();
  sdk.send.mockImplementation(async (command) => {
    if (command instanceof PutObjectCommand) {
      const { Key: key, Body: body } = command.input;
      if (!key || typeof body !== "string") throw new Error("Invalid PUT");
      if (objects.has(key))
        throw Object.assign(new Error("Immutable object already exists"), {
          $metadata: { httpStatusCode: 412 },
        });
      objects.set(key, body);
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      return {
        Contents: [...objects.keys()]
          .filter((key) => key.startsWith(command.input.Prefix ?? ""))
          .map((Key) => ({ Key })),
        IsTruncated: false,
      };
    }
    if (command instanceof GetObjectCommand) {
      const body = objects.get(command.input.Key ?? "");
      if (body === undefined) throw new Error("Missing object");
      return objectBody(body);
    }
    throw new Error("Unexpected S3 command");
  });
});

async function seedA() {
  await ErasureJournal.append({ userId, matrixIds: [matrixA], departures: [] });
  const entry = [...objects.entries()][0];
  if (!entry) throw new Error("Missing synthetic object");
  sdk.send.mockClear();
  sdk.destroy.mockClear();
  sdk.created.mockClear();
  return entry;
}

test("namespace intents remain immutable and cannot be read as account deletion", async () => {
  const scope = {
    kind: "private-memory",
    ownerUserId: userId,
    namespaceId: "10000000-0000-4000-8000-000000000001",
  } satisfies Parameters<typeof ErasureJournal.appendMemoryNamespace>[0];
  await ErasureJournal.appendMemoryNamespace(scope);
  await ErasureJournal.appendMemoryNamespace(scope);
  expect(objects.size).toBe(1);
  const accounts = [];
  for await (const record of ErasureJournal.read()) accounts.push(record);
  expect(accounts).toEqual([]);
  const namespaces = [];
  for await (const record of ErasureJournal.readMemoryNamespaces(userId))
    namespaces.push(record);
  expect(namespaces).toEqual([{ ...scope, version: 1 }]);
});

test("namespace replay rejects an owner changed under the original immutable key", async () => {
  await ErasureJournal.appendMemoryNamespace({
    kind: "private-memory",
    ownerUserId: userId,
    namespaceId: "10000000-0000-4000-8000-000000000002",
  });
  const entry = [...objects.entries()][0];
  if (!entry) throw new Error("Missing synthetic namespace intent");
  const [key, body] = entry;
  objects.set(key, body.replace(userId, "better-auth:forged-owner"));
  await expect(
    ErasureJournal.readMemoryNamespaces().next()
  ).rejects.toMatchObject({
    _tag: "ErasureJournalError",
    reason: "unavailable",
  });
});

async function collect() {
  const records = [];
  for await (const record of ErasureJournal.read()) records.push(record);
  return records;
}

describe("immutable erasure journal transport", () => {
  test("canonicalizes order, duplicates and departure IDs before hashing", async () => {
    await ErasureJournal.append({
      userId,
      matrixIds: [matrixB, matrixB],
      departures: [reference, reference],
    });
    await ErasureJournal.append({
      departures: [
        {
          organizationId: reference.organizationId,
          workspaceId: reference.workspaceId,
          installationId: reference.installationId,
          roomId: reference.roomId,
          matrixId: reference.matrixId,
          bindingId: reference.bindingId,
        },
      ],
      matrixIds: [matrixA, matrixB],
      userId,
    });
    expect(objects.size).toBe(1);
    const entry = [...objects.entries()][0];
    if (!entry) throw new Error("Missing canonical object");
    const [key, body] = entry;
    expect(body).toBe(
      JSON.stringify({
        version: 1,
        userId,
        matrixIds: [matrixA, matrixB],
        departures: [reference],
      })
    );
    expect(key).toBe(
      `erasures/${Buffer.from(userId).toString("base64url")}/${createHash("sha256").update(body).digest("hex")}.json`
    );
    for (const [command] of sdk.send.mock.calls) {
      expect(command).toBeInstanceOf(PutObjectCommand);
      if (!(command instanceof PutObjectCommand))
        throw new Error("Expected PUT");
      expect(command.input).toMatchObject({ IfNoneMatch: "*", Body: body });
    }
    expect(sdk.destroy).toHaveBeenCalledTimes(2);
  });

  test("keeps A and A+B as distinct records and preserves no-room IDs", async () => {
    await seedA();
    await ErasureJournal.append({
      userId,
      matrixIds: [matrixA, matrixB],
      departures: [],
    });
    expect(objects.size).toBe(2);
    expect(await collect()).toEqual([
      { version: 1, userId, matrixIds: [matrixA], departures: [] },
      { version: 1, userId, matrixIds: [matrixA, matrixB], departures: [] },
    ]);
  });

  test("streams pages sequentially and retains the client while replay is suspended", async () => {
    const [keyA, bodyA] = await seedA();
    await ErasureJournal.append({
      userId,
      matrixIds: [matrixA, matrixB],
      departures: [],
    });
    const keyB = [...objects.keys()].find((key) => key !== keyA);
    if (!keyB) throw new Error("Missing second object");
    sdk.send.mockReset();
    sdk.destroy.mockClear();
    sdk.send
      .mockResolvedValueOnce({
        Contents: [{ Key: keyA }],
        IsTruncated: true,
        NextContinuationToken: "page-2",
      })
      .mockResolvedValueOnce(objectBody(bodyA))
      .mockResolvedValueOnce({ Contents: [{ Key: keyB }], IsTruncated: false })
      .mockResolvedValueOnce(objectBody(objects.get(keyB) ?? ""));
    const iterator = ErasureJournal.read(userId);
    expect(sdk.send).not.toHaveBeenCalled();
    expect((await iterator.next()).value?.matrixIds).toEqual([matrixA]);
    expect(sdk.send).toHaveBeenCalledTimes(2);
    expect(sdk.destroy).not.toHaveBeenCalled();
    expect((await iterator.next()).value?.matrixIds).toEqual([
      matrixA,
      matrixB,
    ]);
    expect(sdk.send).toHaveBeenCalledTimes(4);
    const page = sdk.send.mock.calls[2]?.[0];
    expect(page).toBeInstanceOf(ListObjectsV2Command);
    if (!(page instanceof ListObjectsV2Command))
      throw new Error("Expected LIST");
    expect(page.input).toMatchObject({
      Prefix: `erasures/${Buffer.from(userId).toString("base64url")}/`,
      ContinuationToken: "page-2",
      MaxKeys: 100,
    });
    expect(sdk.destroy).not.toHaveBeenCalled();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  test("destroys the client when the consumer stops after one record", async () => {
    await seedA();
    for await (const record of ErasureJournal.read()) {
      expect(record.matrixIds).toEqual([matrixA]);
      break;
    }
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  test("destroys the client when the replay consumer throws", async () => {
    await seedA();
    await expect(
      (async () => {
        for await (const record of ErasureJournal.read()) {
          expect(record.userId).toBe(userId);
          throw new Error("SQL replay failed");
        }
      })()
    ).rejects.toThrow("SQL replay failed");
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["invalid JSON", "{"],
    ["old incomplete record", JSON.stringify({ userId })],
    [
      "unknown field",
      JSON.stringify({
        version: 1,
        userId,
        matrixIds: [matrixA],
        departures: [],
        unexpected: true,
      }),
    ],
    [
      "wrong version",
      JSON.stringify({
        version: 2,
        userId,
        matrixIds: [matrixA],
        departures: [],
      }),
    ],
    [
      "wrong digest",
      JSON.stringify({
        version: 1,
        userId,
        matrixIds: [matrixB],
        departures: [],
      }),
    ],
    [
      "invalid Matrix coordinate",
      JSON.stringify({
        version: 1,
        userId,
        matrixIds: ["synthetic-a"],
        departures: [],
      }),
    ],
  ])("rejects %s before yielding a record", async (_description, body) => {
    const [key] = await seedA();
    objects.set(key, body);
    await expect(ErasureJournal.read().next()).rejects.toMatchObject({
      _tag: "ErasureJournalError",
      reason: "unavailable",
    });
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  test("rejects oversized metadata before consuming the body", async () => {
    const [key] = await seedA();
    const transformToWebStream = vi.fn<() => ReadableStream<Uint8Array>>(
      () => new ReadableStream<Uint8Array>()
    );
    sdk.send
      .mockResolvedValueOnce({ Contents: [{ Key: key }], IsTruncated: false })
      .mockResolvedValueOnce({
        ContentLength: 4 * 1024 * 1024 + 1,
        Body: { transformToWebStream },
      });
    await expect(ErasureJournal.read().next()).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(transformToWebStream).not.toHaveBeenCalled();
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  test("enforces the byte cap when ContentLength understates a streamed body", async () => {
    const [key] = await seedA();
    sdk.send
      .mockResolvedValueOnce({ Contents: [{ Key: key }], IsTruncated: false })
      .mockResolvedValueOnce(objectBody("x".repeat(4 * 1024 * 1024 + 1), 0));
    await expect(ErasureJournal.read().next()).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  test("rejects conflicting exact departure references before PUT", async () => {
    await expect(
      ErasureJournal.append({
        userId,
        matrixIds: [],
        departures: [
          reference,
          { ...reference, roomId: "!another-room:synthetic.invalid" },
        ],
      })
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(sdk.send).not.toHaveBeenCalled();
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  test("enforces the combined unique Matrix handle limit before PUT", async () => {
    await expect(
      ErasureJournal.append({
        userId,
        matrixIds: Array.from(
          { length: 1024 },
          (_, i) => `@synthetic-${i}:synthetic.invalid`
        ),
        departures: [reference],
      })
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(sdk.send).not.toHaveBeenCalled();
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  test("rejects keys outside the requested prefix without fetching them", async () => {
    sdk.send.mockResolvedValueOnce({
      Contents: [{ Key: "other-prefix/invalid.json" }],
      IsTruncated: false,
    });
    await expect(ErasureJournal.read().next()).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(sdk.send).toHaveBeenCalledTimes(1);
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  test("rejects oversized listing pages", async () => {
    sdk.send.mockResolvedValueOnce({
      Contents: Array.from({ length: 101 }, () => ({
        Key: "erasures/invalid.json",
      })),
      IsTruncated: false,
    });
    await expect(ErasureJournal.read().next()).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(sdk.send).toHaveBeenCalledTimes(1);
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  test("rejects a continuation cycle without requesting a fourth page", async () => {
    sdk.send
      .mockResolvedValueOnce({
        Contents: [],
        IsTruncated: true,
        NextContinuationToken: "A",
      })
      .mockResolvedValueOnce({
        Contents: [],
        IsTruncated: true,
        NextContinuationToken: "B",
      })
      .mockResolvedValueOnce({
        Contents: [],
        IsTruncated: true,
        NextContinuationToken: "A",
      })
      .mockRejectedValueOnce(new Error("Unexpected fourth page"));
    await expect(ErasureJournal.read().next()).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(sdk.send).toHaveBeenCalledTimes(3);
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });
});

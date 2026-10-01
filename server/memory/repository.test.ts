import type { z } from "zod";
import { randomUUID } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { publishPrivateMemoryGit } from "./git";
import type { memoryNamespace } from "./namespace";
import {
  PrivateMemoryError,
  PrivateMemoryRepository,
  PrivateMemoryBackupSchema,
} from "./repository";
import { WorkspaceAccessDenied } from "../workspaces/access";

const owners = vi.hoisted(() => ({
  transaction: vi.fn<typeof import("@db/queries").transaction>(),
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  access: vi.fn<() => Promise<boolean>>(),
  namespace: vi.fn<typeof memoryNamespace>(),
  selection: vi.fn<
    (
      actor: unknown,
      paths: readonly string[]
    ) => Promise<{
      documents: { path: string; content: string }[];
    }>
  >(),
  session: vi.fn<(actor: unknown, citation: unknown) => Promise<boolean>>(),
  backup: vi.fn<typeof import("./session-export").backupSessionClaimSources>(),
  restore:
    vi.fn<typeof import("./session-export").restoreSessionClaimSources>(),
}));
vi.mock("@db/queries", () => ({
  query: owners.query,
  transaction: owners.transaction,
  SqlError: class extends Error {},
}));
vi.mock("../workspaces/access", async (original) => ({
  ...(await original<typeof import("../workspaces/access")>()),
  requireWorkspaceAccess: owners.access,
}));
vi.mock("../workspaces/repository", () => ({
  WorkspaceRepository: { selection: owners.selection },
}));
// Historical owner-boundary harness; runtime erasure acceptance uses real PostgreSQL.
vi.mock("./namespace", async (original) => ({
  ...(await original<typeof import("./namespace")>()),
  memoryNamespace: owners.namespace,
}));
vi.mock("./session-export", () => ({
  verifySessionClaimSource: owners.session,
  backupSessionClaimSources: owners.backup,
  restoreSessionClaimSources: owners.restore,
  SessionArchiveUnavailable: class extends Error {},
}));

const actor = {
  workspaceId: "private-backup-team",
  userId: "private-backup-owner",
  authSessionId: "synthetic-backup-auth-session",
};
const scope = { workspaceId: actor.workspaceId, userId: actor.userId };
const fileSource = {
  kind: "file" as const,
  path: "knowledge/retained.md",
  revision: "a".repeat(40),
  excerpt: "Original governed company passage",
};
const sessionSource = {
  kind: "session" as const,
  sessionId: "synthetic-retained-session",
  eventId: "synthetic-retained-event",
  sha256: "b".repeat(64),
  excerpt: "Retained personal passage",
};

async function history() {
  const claimId = randomUUID();
  const first = await publishPrivateMemoryGit({
    scope,
    head: null,
    bundle: null,
    change: {
      action: "assert",
      operationId: randomUUID(),
      claimId,
      expectedRevision: null,
      body: {
        text: "Original claim",
        sources: [fileSource],
        relations: [],
        validTime: null,
      },
    },
    publication: async () => ({
      authorUserId: scope.userId,
      recordedAt: "2026-10-01T03:00:00.000001Z",
    }),
  });
  if (!first.applied) throw new Error("Expected original Git publication");
  const corrected = await publishPrivateMemoryGit({
    scope,
    head: first.receipt.revision,
    bundle: first.bundle,
    change: {
      action: "correct",
      operationId: randomUUID(),
      claimId,
      expectedRevision: first.receipt.revision,
      body: {
        text: "Corrected claim",
        sources: [sessionSource],
        relations: [],
        validTime: null,
      },
    },
    publication: async () => ({
      authorUserId: scope.userId,
      recordedAt: "2026-10-01T03:00:00.000002Z",
    }),
  });
  if (!corrected.applied) throw new Error("Expected correction publication");
  const cleared = await publishPrivateMemoryGit({
    scope,
    head: corrected.receipt.revision,
    bundle: corrected.bundle,
    change: {
      action: "clear",
      operationId: randomUUID(),
      expectedRevision: corrected.receipt.revision,
    },
    publication: async () => ({
      authorUserId: scope.userId,
      recordedAt: "2026-10-01T03:00:00.000003Z",
    }),
  });
  if (!cleared.applied) throw new Error("Expected clear publication");
  return { head: cleared.receipt.revision, bundle: cleared.bundle };
}
let retained: Awaited<ReturnType<typeof history>>;
beforeAll(async () => {
  retained = await history();
});
beforeEach(() => {
  vi.clearAllMocks();
  owners.transaction.mockReset().mockImplementation((run) => run());
  owners.access.mockReset().mockResolvedValue(true);
  owners.namespace.mockReset().mockResolvedValue({
    id: "3a3df84d-d3d8-4189-99ea-f2d49807067e",
    enabled: true,
    workspaceEnabled: true,
    scopeKey: null,
    pendingOperation: null,
    pendingHash: null,
  });
  owners.session.mockReset().mockResolvedValue(true);
  owners.backup
    .mockReset()
    .mockImplementation(async (principal, _namespace, citations) => {
      for (const citation of citations)
        if (!(await owners.session(principal, citation)))
          throw new PrivateMemoryError("invalid_input");
      return [
        {
          sessionId: sessionSource.sessionId,
          eventId: sessionSource.eventId,
          captureSequence: 7,
          content: Buffer.from([1, 2, 3]),
        },
      ];
    });
  owners.restore
    .mockReset()
    .mockImplementation(async (principal, _namespace, citations) => {
      for (const citation of citations)
        if (!(await owners.session(principal, citation)))
          throw new PrivateMemoryError("invalid_input");
      return { files: 1, receipts: 0 };
    });
  owners.selection.mockReset().mockImplementation(async (_actor, paths) => ({
    documents: paths.map((path) => ({
      path,
      content: fileSource.excerpt,
    })),
  }));
  owners.query.mockReset().mockImplementation(async (statement) => {
    const compiled = new PgDialect().sqlToQuery(statement);
    if (compiled.sql.includes("FROM workspace_memory_erasure")) return [];
    if (!compiled.sql.includes("FROM private_memory_repository"))
      throw new Error("Backup must only read its private repository");
    return [retained];
  });
});

for (const principal of [
  actor,
  { ...actor, workspaceId: "private-backup-personal" },
]) {
  test(`unsourced ${principal.workspaceId} claims remain readable only when their exact namespace has no pending erasure`, async () => {
    const privateScope = {
      workspaceId: principal.workspaceId,
      userId: principal.userId,
    };
    const publication = await publishPrivateMemoryGit({
      scope: privateScope,
      head: null,
      bundle: null,
      change: {
        action: "assert",
        operationId: randomUUID(),
        claimId: randomUUID(),
        expectedRevision: null,
        body: {
          text: "Private unsourced preference",
          sources: [],
          relations: [],
          validTime: null,
        },
      },
      publication: async () => ({
        authorUserId: principal.userId,
        recordedAt: "2026-10-01T03:00:00.000001Z",
      }),
    });
    if (!publication.applied) throw new Error("Expected private publication");
    let pendingNamespace = "8a55b657-573e-4d5b-af0d-fca0d96d208d";
    owners.query.mockImplementation(async (statement) => {
      const compiled = new PgDialect().sqlToQuery(statement);
      if (compiled.sql.includes("FROM workspace_memory_erasure"))
        return pendingNamespace === compiled.params[0]
          ? [{ namespace_id: pendingNamespace }]
          : [];
      if (!compiled.sql.includes("FROM private_memory_repository"))
        throw new Error("Unexpected private memory query");
      return [
        { head: publication.receipt.revision, bundle: publication.bundle },
      ];
    });
    const value = await PrivateMemoryRepository.read(principal);
    expect(owners.query).toHaveBeenCalledTimes(2);
    const [presence] = owners.query.mock.calls.map(([statement]) =>
      new PgDialect().sqlToQuery(statement)
    );
    expect(presence?.sql).toMatch(/WHERE namespace_id = \$1/u);
    expect(presence?.params).toEqual(["3a3df84d-d3d8-4189-99ea-f2d49807067e"]);
    expect(value.snapshot.claims[0]?.file.state).toMatchObject({
      kind: "active",
      body: { text: "Private unsourced preference", sources: [] },
    });
    expect(owners.selection).not.toHaveBeenCalled();
    expect(owners.session).not.toHaveBeenCalled();
    owners.query.mockClear();
    pendingNamespace = "3a3df84d-d3d8-4189-99ea-f2d49807067e";
    await expect(PrivateMemoryRepository.read(principal)).rejects.toMatchObject(
      {
        reason: "conflict",
      }
    );
    expect(owners.query).toHaveBeenCalledTimes(1);
  });

  for (const operation of [
    {
      name: "read",
      run: () => PrivateMemoryRepository.read(principal),
    },
    {
      name: "recall",
      run: () =>
        PrivateMemoryRepository.recall(
          principal,
          "synthetic-private-scope",
          randomUUID(),
          "Original claim"
        ),
    },
    {
      name: "change",
      run: () =>
        PrivateMemoryRepository.change(principal, {
          action: "clear",
          operationId: randomUUID(),
          expectedRevision: retained.head,
        }),
    },
    {
      name: "history",
      run: () => PrivateMemoryRepository.history(principal, randomUUID()),
    },
    {
      name: "rebuild",
      run: () => PrivateMemoryRepository.rebuildOperations(principal),
    },
  ]) {
    test(`${operation.name} withholds a restored ${principal.workspaceId} namespace with pending erasure before Git or source work`, async () => {
      owners.query.mockImplementation(async (statement) => {
        const compiled = new PgDialect().sqlToQuery(statement);
        expect(compiled.sql).toContain("FROM workspace_memory_erasure");
        expect(compiled.sql).not.toMatch(
          /FOR SHARE|FOR UPDATE|SKIP LOCKED|available_at/u
        );
        expect(compiled.params).toEqual([
          "3a3df84d-d3d8-4189-99ea-f2d49807067e",
        ]);
        return [{ namespace_id: compiled.params[0] }];
      });
      await expect(operation.run()).rejects.toMatchObject({
        reason: "conflict",
      });
      expect(owners.namespace).toHaveBeenCalledExactlyOnceWith(
        principal,
        operation.name === "recall" ? "synthetic-private-scope" : undefined
      );
      expect(owners.query).toHaveBeenCalledTimes(1);
      expect(owners.namespace.mock.invocationCallOrder[0]).toBeLessThan(
        owners.query.mock.invocationCallOrder[0] ?? -1
      );
      expect(owners.selection).not.toHaveBeenCalled();
      expect(owners.session).not.toHaveBeenCalled();
      expect(owners.backup).not.toHaveBeenCalled();
      expect(owners.restore).not.toHaveBeenCalled();
    });
  }
}

test("cleared private backup reauthorizes original file and session evidence from its real Git lineage", async () => {
  const archive = await PrivateMemoryRepository.backup(actor);
  expect(archive).toMatchObject({
    version: 2,
    scope,
    revision: retained.head,
    namespaceId: "3a3df84d-d3d8-4189-99ea-f2d49807067e",
  });
  expect(Buffer.from(archive.bundle ?? [])).toEqual(
    Buffer.from(retained.bundle)
  );
  expect(archive.integrity).toMatch(/^[a-f0-9]{64}$/u);
  expect(owners.session).toHaveBeenCalledExactlyOnceWith(actor, sessionSource);
  expect(owners.selection).toHaveBeenCalledExactlyOnceWith(
    actor,
    [fileSource.path],
    { revision: fileSource.revision }
  );
  expect(owners.access).toHaveBeenCalledTimes(2);
  expect(owners.query).toHaveBeenCalledTimes(3);
});

test("clearing or correcting a claim cannot export an older citation whose file permission was revoked", async () => {
  owners.selection.mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(PrivateMemoryRepository.backup(actor)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
  expect(owners.selection).toHaveBeenCalledExactlyOnceWith(
    actor,
    [fileSource.path],
    { revision: fileSource.revision }
  );
  expect(owners.query).toHaveBeenCalledTimes(3);
});

test("backup refuses unverifiable retained session evidence even after clear", async () => {
  owners.session.mockResolvedValueOnce(false);
  await expect(PrivateMemoryRepository.backup(actor)).rejects.toMatchObject({
    reason: "invalid_input",
  });
  expect(owners.session).toHaveBeenCalledExactlyOnceWith(actor, sessionSource);
  expect(owners.selection).toHaveBeenCalledTimes(1);
});

test("backup refuses a recorded citation whose excerpt does not match the authorized version", async () => {
  owners.selection.mockResolvedValueOnce({
    documents: [{ path: fileSource.path, content: "Different passage" }],
  });
  await expect(PrivateMemoryRepository.backup(actor)).rejects.toBeInstanceOf(
    PrivateMemoryError
  );
});

test("backup rechecks the current actor after retained evidence authorization", async () => {
  owners.access
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(PrivateMemoryRepository.backup(actor)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
  expect(owners.selection).toHaveBeenCalledTimes(1);
  expect(owners.access).toHaveBeenCalledTimes(2);
});

for (const denied of [
  { ...actor, authSessionId: undefined },
  { ...actor, channelIdentityId: "synthetic-channel" },
  { ...actor, matrixIdentityId: "synthetic-matrix" },
  { ...actor, agentGrantId: "9f4d27c9-6555-4290-b3dc-786c36b8552d" },
]) {
  test(`backup denies a non-private app principal before reading retained bytes: ${JSON.stringify(denied)}`, async () => {
    await expect(PrivateMemoryRepository.backup(denied)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
    expect(owners.query).not.toHaveBeenCalled();
    expect(owners.session).not.toHaveBeenCalled();
    expect(owners.selection).not.toHaveBeenCalled();
  });
}

test("same-head restore reauthorizes historical evidence even when every current claim is cleared", async () => {
  const archive = await PrivateMemoryRepository.backup(actor);
  owners.selection.mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(
    PrivateMemoryRepository.restore(actor, {
      expectedRevision: retained.head,
      archive,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("same-head signed restore preserves its no-op receipt after complete lineage authorization", async () => {
  const archive = await PrivateMemoryRepository.backup(actor);
  vi.clearAllMocks();
  await expect(
    PrivateMemoryRepository.restore(actor, {
      expectedRevision: retained.head,
      archive,
    })
  ).resolves.toEqual({ applied: false, revision: retained.head });
  expect(owners.session).toHaveBeenCalledExactlyOnceWith(actor, sessionSource);
  expect(owners.selection).toHaveBeenCalledExactlyOnceWith(
    actor,
    [fileSource.path],
    { revision: fileSource.revision }
  );
  expect(owners.query).toHaveBeenCalledTimes(3);
  expect(owners.transaction).toHaveBeenCalledWith(expect.any(Function), {
    outermost: true,
  });
});

test("restore requests a real outermost boundary before authorization, queries or source work", async () => {
  const archive = await PrivateMemoryRepository.backup(actor);
  vi.clearAllMocks();
  const failure = new Error("Synthetic native transaction boundary rejection");
  owners.transaction.mockRejectedValueOnce(failure);
  await expect(
    PrivateMemoryRepository.restore(actor, {
      expectedRevision: retained.head,
      archive,
    })
  ).rejects.toBe(failure);
  expect(owners.transaction).toHaveBeenCalledExactlyOnceWith(
    expect.any(Function),
    { outermost: true }
  );
  expect(owners.access).not.toHaveBeenCalled();
  expect(owners.namespace).not.toHaveBeenCalled();
  expect(owners.query).not.toHaveBeenCalled();
  expect(owners.session).not.toHaveBeenCalled();
  expect(owners.selection).not.toHaveBeenCalled();
});

test("same-head restore refuses an outstanding exact-namespace erasure before reading retained history", async () => {
  const archive = await PrivateMemoryRepository.backup(actor);
  vi.clearAllMocks();
  owners.query.mockImplementation(async (statement) => {
    const compiled = new PgDialect().sqlToQuery(statement);
    expect(compiled.sql).toContain("FROM workspace_memory_erasure");
    expect(compiled.sql).not.toMatch(
      /FOR SHARE|FOR UPDATE|SKIP LOCKED|available_at/u
    );
    expect(compiled.params).toEqual([archive.namespaceId]);
    return [{ namespace_id: archive.namespaceId }];
  });
  await expect(
    PrivateMemoryRepository.restore(actor, {
      expectedRevision: retained.head,
      archive,
    })
  ).rejects.toMatchObject({ reason: "conflict" });
  expect(owners.query).toHaveBeenCalledTimes(1);
  expect(owners.session).not.toHaveBeenCalled();
  expect(owners.selection).not.toHaveBeenCalled();
});

test("obsolete v1 backup is deliberately rejected without source/SQL work", async () => {
  const archive = await PrivateMemoryRepository.backup(actor);
  const old = { ...archive, version: 1 };
  expect(PrivateMemoryBackupSchema.safeParse(old).success).toBe(false);
  vi.clearAllMocks();
  Reflect.set(archive, "version", 1);
  await expect(
    PrivateMemoryRepository.restore(actor, {
      expectedRevision: retained.head,
      archive,
    })
  ).rejects.toMatchObject({ reason: "invalid_input" });
  expect(owners.transaction).not.toHaveBeenCalled();
  expect(owners.restore).not.toHaveBeenCalled();
});

test("v2 authentication binds exact raw-source bytes, sequence and coordinates", async () => {
  for (const mutate of [
    (source: z.output<typeof PrivateMemoryBackupSchema>["sources"][number]) =>
      source.content.fill(9),
    (source: z.output<typeof PrivateMemoryBackupSchema>["sources"][number]) => {
      source.captureSequence++;
    },
    (source: z.output<typeof PrivateMemoryBackupSchema>["sources"][number]) => {
      source.sessionId = "another-session";
    },
    (source: z.output<typeof PrivateMemoryBackupSchema>["sources"][number]) => {
      source.eventId = "another-event";
    },
  ]) {
    const archive = await PrivateMemoryRepository.backup(actor);
    const source = archive.sources[0];
    if (!source) throw new Error("Missing synthetic source");
    mutate(source);
    owners.restore.mockClear();
    await expect(
      PrivateMemoryRepository.restore(actor, {
        expectedRevision: retained.head,
        archive,
      })
    ).rejects.toMatchObject({ reason: "invalid_input" });
    expect(owners.restore).not.toHaveBeenCalled();
  }
});

test("same-head restore repairs sources before returning its Git no-op", async () => {
  const archive = await PrivateMemoryRepository.backup(actor);
  await PrivateMemoryRepository.restore(actor, {
    expectedRevision: retained.head,
    archive,
  });
  expect(owners.restore).toHaveBeenCalledExactlyOnceWith(
    actor,
    archive.namespaceId,
    [sessionSource],
    archive.sources.map((source) => ({
      sessionId: source.sessionId,
      eventId: source.eventId,
      captureSequence: source.captureSequence,
      content: Uint8Array.from(source.content),
    }))
  );
});

test("restore snapshots authenticated mutable bytes before waiting for the native boundary", async () => {
  const archive = await PrivateMemoryRepository.backup(actor);
  owners.transaction.mockImplementationOnce(async (run) => {
    await Promise.resolve();
    return run();
  });
  const pending = PrivateMemoryRepository.restore(actor, {
    expectedRevision: retained.head,
    archive,
  });
  archive.sources[0]?.content.fill(9);
  archive.bundle?.fill(9);
  await expect(pending).resolves.toEqual({
    applied: false,
    revision: retained.head,
  });
  expect(owners.restore.mock.calls.at(-1)?.[3][0]?.content).toEqual(
    new Uint8Array([1, 2, 3])
  );
});

test("backup withholds an exact namespace awaiting erasure before Git/source export", async () => {
  owners.query.mockImplementation(async (statement) => {
    const compiled = new PgDialect().sqlToQuery(statement);
    expect(compiled.sql).toContain("FROM workspace_memory_erasure");
    expect(compiled.sql).not.toMatch(
      /FOR SHARE|FOR UPDATE|SKIP LOCKED|available_at/u
    );
    expect(compiled.params).toEqual(["3a3df84d-d3d8-4189-99ea-f2d49807067e"]);
    return [{ namespace_id: compiled.params[0] }];
  });
  await expect(PrivateMemoryRepository.backup(actor)).rejects.toMatchObject({
    reason: "conflict",
  });
  expect(owners.query).toHaveBeenCalledTimes(1);
  expect(owners.backup).not.toHaveBeenCalled();
  expect(owners.selection).not.toHaveBeenCalled();
});

test("v2 source count and total bytes are rejected before parsing individual archive entries", async () => {
  const archive = await PrivateMemoryRepository.backup(actor);
  const parsed = vi.fn<() => never>(() => {
    throw new Error("Oversize entry must not be parsed");
  });
  const item = {
    sessionId: "bounded-session",
    eventId: "bounded-event",
    captureSequence: 7,
    content: new Uint8Array(8_388_608),
  };
  Object.defineProperty(item, "sessionId", { get: parsed });
  expect(
    PrivateMemoryBackupSchema.safeParse({
      ...archive,
      sources: Array.from({ length: 17 }, () => item),
    }).success
  ).toBe(false);
  expect(parsed).not.toHaveBeenCalled();
  expect(
    PrivateMemoryBackupSchema.safeParse({
      ...archive,
      sources: Array.from({ length: 10_001 }, () => item),
    }).success
  ).toBe(false);
  expect(parsed).not.toHaveBeenCalled();
});

test("an authenticated archive from a retired namespace cannot restore into a fresh generation of the same owner and workspace", async () => {
  const archive = await PrivateMemoryRepository.backup(actor);
  const current = await owners.namespace(actor);
  owners.namespace.mockResolvedValue({
    ...current,
    id: "10000000-0000-4000-8000-000000000099",
  });
  vi.clearAllMocks();
  await expect(
    PrivateMemoryRepository.restore(actor, {
      expectedRevision: null,
      archive,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(owners.restore).not.toHaveBeenCalled();
  expect(owners.selection).not.toHaveBeenCalled();
  expect(owners.session).not.toHaveBeenCalled();
});

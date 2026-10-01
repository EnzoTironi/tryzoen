import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as queries from "@db/queries";
import {
  PrivateMemoryRepository,
  PrivateMemoryError,
} from "../../server/memory/repository";
import { readWorkspaceGit } from "../../server/workspaces/git";
import { workspaceFixture } from "./workspace-fixture";

const body = (text: string) => ({
  text,
  sources: [],
  relations: [],
  validTime: null,
});
const assertion = (text: string) => ({
  action: "assert" as const,
  operationId: randomUUID(),
  claimId: randomUUID(),
  expectedRevision: null,
  body: body(text),
});

test("two people in one workspace own different private bundles; shared history/export/search contain neither", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest, repository } = fixture;
  const shared = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes: [{ path: "knowledge/shared.md", content: "Shared guidance only" }],
  });
  const left = await PrivateMemoryRepository.change(
    actor,
    assertion("Owner's private cedar preference")
  );
  const right = await PrivateMemoryRepository.change(
    guest,
    assertion("Guest's private maple preference")
  );
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.claims.map(
      (item) => item.file.state
    )
  ).toEqual([
    { kind: "active", body: body("Owner's private cedar preference") },
  ]);
  expect(
    (await PrivateMemoryRepository.read(guest)).snapshot.claims.map(
      (item) => item.file.state
    )
  ).toEqual([
    { kind: "active", body: body("Guest's private maple preference") },
  ]);
  expect(left.receipt.scope.userId).toBe(actor.userId);
  expect(right.receipt.scope.userId).toBe(guest.userId);
  const exported = await repository.export(actor);
  expect(exported?.head).toBe(shared.revision);
  if (!exported) throw new Error("Expected shared bundle");
  expect(
    (await readWorkspaceGit(exported.bundle, exported.head)).files
  ).toEqual(["knowledge/shared.md"]);
  expect(await repository.search(guest, "private")).toMatchObject({
    matches: [],
  });
  await expect(
    PrivateMemoryRepository.read(actor, { revision: right.receipt.revision })
  ).rejects.toMatchObject({ reason: "invalid_input" });
});

test("concurrent changes with the same CAS admit one write and produce one canonical receipt", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  await PrivateMemoryRepository.read(actor);
  const results = await Promise.allSettled([
    PrivateMemoryRepository.change(actor, assertion("First competing note")),
    PrivateMemoryRepository.change(actor, assertion("Second competing note")),
  ]);
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  const failed = results.find((item) => item.status === "rejected");
  expect(failed?.status === "rejected" && failed.reason).toBeInstanceOf(
    PrivateMemoryError
  );
  expect(failed?.status === "rejected" && failed.reason).toMatchObject({
    reason: "conflict",
  });
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.claims
  ).toHaveLength(1);
});

test("lost receipt indexes rebuild from files/Git without losing facts, timestamps, tombstones or replay safety", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  const initial = assertion("Weekly private report");
  const first = await PrivateMemoryRepository.change(actor, initial);
  if (!first.applied || !first.claim) throw new Error("Expected publication");
  const deleted = await PrivateMemoryRepository.change(actor, {
    action: "tombstone",
    operationId: randomUUID(),
    claimId: initial.claimId,
    expectedRevision: first.receipt.revision,
  });
  if (!deleted.applied || !deleted.claim) throw new Error("Expected tombstone");
  await queries.query(sql`DELETE FROM private_memory_operation WHERE namespace_id IN
    (SELECT namespace_id FROM workspace_memory_namespace WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId})`);
  const historical = await PrivateMemoryRepository.read(actor, {
    asOf: first.claim.recordedAt,
  });
  expect(historical.snapshot.claims[0]).toEqual(first.claim);
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.claims[0]?.file.state
  ).toEqual({ kind: "tombstone" });
  expect(await PrivateMemoryRepository.rebuildOperations(actor)).toEqual({
    revision: deleted.receipt.revision,
    operations: 2,
  });
  expect(await PrivateMemoryRepository.change(actor, initial)).toEqual({
    applied: false,
    receipt: first.receipt,
  });
  expect(
    (await PrivateMemoryRepository.history(actor, initial.claimId)).versions
  ).toEqual([deleted.claim, first.claim]);
});

test("receipt persistence failure rolls back bundle/head and retry cannot observe a partial publication", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  const change = assertion("Atomic publication only");
  const original = queries.query;
  const dialect = new PgDialect();
  const spy = vi
    .spyOn(queries, "query")
    .mockImplementation(
      async <Row extends Record<string, unknown>>(
        statement: Parameters<typeof queries.query>[0]
      ): Promise<Row[]> => {
        if (
          dialect
            .sqlToQuery(statement)
            .sql.startsWith("INSERT INTO private_memory_operation")
        )
          throw new queries.SqlError(
            new Error("Synthetic receipt persistence failure")
          );
        return original<Row>(statement);
      }
    );
  try {
    await expect(
      PrivateMemoryRepository.change(actor, change)
    ).rejects.toMatchObject({ reason: "unavailable" });
  } finally {
    spy.mockRestore();
  }
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.revision
  ).toBeNull();
  const result = await PrivateMemoryRepository.change(actor, change);
  expect(result.applied).toBe(true);
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.claims
  ).toHaveLength(1);
});

test("unverified or changed evidence cannot yield current facts; explicit audit keeps the recorded source version", async () => {
  await using fixture = await workspaceFixture();
  const { actor, repository } = fixture;
  const source = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes: [
      { path: "knowledge/cadence.md", content: "Cedar reports are weekly" },
    ],
  });
  const input = assertion("Cedar reports are weekly");
  const sources = [
    {
      kind: "file" as const,
      path: "knowledge/cadence.md",
      revision: source.revision,
      excerpt: "Cedar reports are weekly",
    },
  ];
  await expect(
    PrivateMemoryRepository.change(actor, {
      ...input,
      body: {
        ...input.body,
        sources: [
          {
            ...sources[0],
            kind: "file",
            path: "knowledge/cadence.md",
            revision: source.revision,
            excerpt: "Never stated here",
          },
        ],
      },
    })
  ).rejects.toMatchObject({ reason: "invalid_input" });
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.revision
  ).toBeNull();
  const first = await PrivateMemoryRepository.change(actor, {
    ...input,
    body: { ...input.body, sources },
  });
  if (!first.applied || !first.claim)
    throw new Error("Expected verified claim");
  const revised = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: source.revision,
    changes: [
      { path: "knowledge/cadence.md", content: "Cedar reports are monthly" },
    ],
  });
  await expect(PrivateMemoryRepository.read(actor)).rejects.toMatchObject({
    reason: "invalid_input",
  });
  expect(
    (
      await PrivateMemoryRepository.read(actor, {
        revision: first.receipt.revision,
      })
    ).snapshot.claims[0]
  ).toEqual(first.claim);
  const fixed = await PrivateMemoryRepository.change(actor, {
    action: "correct",
    operationId: randomUUID(),
    claimId: input.claimId,
    expectedRevision: first.receipt.revision,
    body: {
      ...body("Cedar reports are monthly"),
      sources: [
        {
          kind: "file",
          path: "knowledge/cadence.md",
          revision: revised.revision,
          excerpt: "Cedar reports are monthly",
        },
      ],
    },
  });
  expect(fixed.applied).toBe(true);
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.claims[0]?.file.state
  ).toMatchObject({ body: { text: "Cedar reports are monthly" } });
});

test("groups, delegation and revoked memberships cannot reach private reads, history, exports or rebuild", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest } = fixture;
  const first = await PrivateMemoryRepository.change(
    guest,
    assertion("Guest confidential note")
  );
  for (const prohibited of [
    { ...actor, groupBindingId: randomUUID() },
    { ...actor, agentGrantId: randomUUID() },
    { ...actor, scheduledRunId: randomUUID() },
  ]) {
    await expect(PrivateMemoryRepository.read(prohibited)).rejects.toThrow(
      "WorkspaceAccessDenied"
    );
    await expect(PrivateMemoryRepository.backup(prohibited)).rejects.toThrow(
      "WorkspaceAccessDenied"
    );
    await expect(
      PrivateMemoryRepository.rebuildOperations(prohibited)
    ).rejects.toThrow("WorkspaceAccessDenied");
  }
  await queries.query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${guest.workspaceId} AND user_id = ${guest.userId}`
  );
  await expect(
    PrivateMemoryRepository.read(guest, { revision: first.receipt.revision })
  ).rejects.toThrow("WorkspaceAccessDenied");
  await expect(PrivateMemoryRepository.backup(guest)).rejects.toThrow(
    "WorkspaceAccessDenied"
  );
});

test("durable private recall replays exact facts and refuses changed queries, scopes, corrections and tombstones", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  const input = assertion("Cedar reports weekly");
  const first = await PrivateMemoryRepository.change(actor, input);
  const operationId = randomUUID();
  const scopeKey = `test-private-${randomUUID()}`;
  const recall = await PrivateMemoryRepository.recall(
    actor,
    scopeKey,
    operationId,
    "cedar report"
  );
  expect(recall).toMatchObject({
    enabled: true,
    revision: first.receipt.revision,
    matches: [
      {
        claim: { file: { state: { body: { text: "Cedar reports weekly" } } } },
      },
    ],
  });
  expect(
    await PrivateMemoryRepository.recall(
      actor,
      scopeKey,
      operationId,
      "cedar report"
    )
  ).toEqual(recall);
  await expect(
    PrivateMemoryRepository.recall(
      actor,
      scopeKey,
      operationId,
      "different request"
    )
  ).rejects.toMatchObject({ reason: "stale_recall" });
  await expect(
    PrivateMemoryRepository.recall(
      actor,
      "foreign-scope",
      randomUUID(),
      "cedar"
    )
  ).rejects.toMatchObject({ reason: "invalid_input" });
  const corrected = await PrivateMemoryRepository.change(actor, {
    action: "correct",
    claimId: input.claimId,
    operationId: randomUUID(),
    expectedRevision: first.receipt.revision,
    body: body("Cedar reports monthly"),
  });
  await expect(
    PrivateMemoryRepository.recall(actor, scopeKey, operationId, "cedar report")
  ).rejects.toMatchObject({ reason: "stale_recall" });
  const next = await PrivateMemoryRepository.recall(
    actor,
    scopeKey,
    randomUUID(),
    "cedar report"
  );
  expect(next.matches[0]?.claim.file.state).toMatchObject({
    body: { text: "Cedar reports monthly" },
  });
  await PrivateMemoryRepository.change(actor, {
    action: "tombstone",
    claimId: input.claimId,
    operationId: randomUUID(),
    expectedRevision: corrected.receipt.revision,
  });
  expect(
    (
      await PrivateMemoryRepository.recall(
        actor,
        scopeKey,
        randomUUID(),
        "cedar"
      )
    ).matches
  ).toEqual([]);
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.claims[0]?.file.state
      .kind
  ).toBe("tombstone");
});

test("private recall receipts never bypass current membership, same-workspace person isolation or machine/group denial", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest } = fixture;
  await PrivateMemoryRepository.change(
    guest,
    assertion("Guest confidential cedar")
  );
  const operationId = randomUUID();
  const guestScope = `guest-${randomUUID()}`;
  const value = await PrivateMemoryRepository.recall(
    guest,
    guestScope,
    operationId,
    "cedar"
  );
  expect(value.matches).toHaveLength(1);
  expect(
    (
      await PrivateMemoryRepository.recall(
        actor,
        `owner-${randomUUID()}`,
        operationId,
        "cedar"
      )
    ).matches
  ).toEqual([]);
  for (const prohibited of [
    { ...guest, agentGrantId: randomUUID() },
    { ...guest, groupBindingId: randomUUID() },
    { ...guest, scheduledRunId: randomUUID() },
  ])
    await expect(
      PrivateMemoryRepository.recall(
        prohibited,
        guestScope,
        operationId,
        "cedar"
      )
    ).rejects.toThrow("WorkspaceAccessDenied");
  await queries.query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${guest.workspaceId} AND user_id = ${guest.userId}`
  );
  await expect(
    PrivateMemoryRepository.recall(guest, guestScope, operationId, "cedar")
  ).rejects.toThrow("WorkspaceAccessDenied");
});

test("unchanged claim revision cannot replay an answer after its source content changes", async () => {
  await using fixture = await workspaceFixture();
  const { actor, repository } = fixture;
  const path = "knowledge/recall-cadence.md";
  const source = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes: [{ path, content: "Cedar reports weekly" }],
  });
  const input = assertion("Cedar reports weekly");
  await PrivateMemoryRepository.change(actor, {
    ...input,
    body: {
      ...input.body,
      sources: [
        {
          kind: "file",
          path,
          revision: source.revision,
          excerpt: "Cedar reports weekly",
        },
      ],
    },
  });
  const scopeKey = `source-${randomUUID()}`;
  const operationId = randomUUID();
  const first = await PrivateMemoryRepository.recall(
    actor,
    scopeKey,
    operationId,
    "cedar"
  );
  await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: source.revision,
    changes: [{ path, content: "Cedar reports monthly" }],
  });
  await expect(
    PrivateMemoryRepository.recall(actor, scopeKey, operationId, "cedar")
  ).rejects.toMatchObject({ reason: "invalid_input" });
  // The recorded snapshot remains an explicit authorized audit, never current recall.
  if (first.revision === null)
    throw new Error("Expected recalled claim revision");
  expect(
    (await PrivateMemoryRepository.read(actor, { revision: first.revision }))
      .snapshot.revision
  ).toBe(first.revision);
});

test("expired or foreign-format recall payloads stay invalid receipts rather than silently fetching newer facts", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  await PrivateMemoryRepository.change(actor, assertion("Cedar preference"));
  const scopeKey = `expired-${randomUUID()}`;
  const operationId = randomUUID();
  await PrivateMemoryRepository.recall(actor, scopeKey, operationId, "cedar");
  await queries.query(sql`UPDATE workspace_memory_recall SET created_at = now() - interval '8 days'
    WHERE operation_id = ${operationId} AND namespace_id IN
      (SELECT namespace_id FROM workspace_memory_namespace WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId})`);
  await PrivateMemoryRepository.recall(actor, scopeKey, randomUUID(), "cedar");
  await expect(
    PrivateMemoryRepository.recall(actor, scopeKey, operationId, "cedar")
  ).rejects.toMatchObject({ reason: "stale_recall" });
  await queries.query(sql`UPDATE workspace_memory_recall SET snapshot = ${JSON.stringify({ enabled: true, results: [{ memory: "old engine fact" }] })}::jsonb
    WHERE operation_id = ${operationId} AND namespace_id IN
      (SELECT namespace_id FROM workspace_memory_namespace WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId})`);
  await expect(
    PrivateMemoryRepository.recall(actor, scopeKey, operationId, "cedar")
  ).rejects.toMatchObject({ reason: "stale_recall" });
});

test("atomic clear keeps all history, rolls back on receipt failure and concurrent retries publish only once", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  const firstInput = assertion("Cedar confidential preference");
  const first = await PrivateMemoryRepository.change(actor, firstInput);
  const second = await PrivateMemoryRepository.change(actor, {
    ...assertion("Maple confidential preference"),
    expectedRevision: first.receipt.revision,
  });
  const clear = {
    action: "clear" as const,
    operationId: randomUUID(),
    expectedRevision: second.receipt.revision,
  };
  const original = queries.query;
  const dialect = new PgDialect();
  const spy = vi
    .spyOn(queries, "query")
    .mockImplementation(
      async <Row extends Record<string, unknown>>(
        statement: Parameters<typeof queries.query>[0]
      ): Promise<Row[]> => {
        if (
          dialect
            .sqlToQuery(statement)
            .sql.startsWith("INSERT INTO private_memory_operation")
        )
          throw new queries.SqlError(
            new Error("Synthetic clear receipt failure")
          );
        return original<Row>(statement);
      }
    );
  try {
    await expect(
      PrivateMemoryRepository.change(actor, clear)
    ).rejects.toMatchObject({ reason: "unavailable" });
  } finally {
    spy.mockRestore();
  }
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.claims.filter(
      (claim) => claim.file.state.kind === "active"
    )
  ).toHaveLength(2);
  const results = await Promise.all([
    PrivateMemoryRepository.change(actor, clear),
    PrivateMemoryRepository.change(actor, clear),
  ]);
  expect(results.filter((result) => result.applied)).toHaveLength(1);
  expect(results[0].receipt).toEqual(results[1].receipt);
  const current = await PrivateMemoryRepository.read(actor);
  expect(current.snapshot.claims.map((claim) => claim.file.state.kind)).toEqual(
    ["tombstone", "tombstone"]
  );
  expect(
    (await PrivateMemoryRepository.history(actor, firstInput.claimId)).versions
  ).toHaveLength(2);
  expect(
    (await PrivateMemoryRepository.rebuildOperations(actor)).operations
  ).toBe(3);
  expect(
    (
      await PrivateMemoryRepository.recall(
        actor,
        `clear-${randomUUID()}`,
        randomUUID(),
        "confidential"
      )
    ).matches
  ).toEqual([]);
});

test("a retained private backup restores a lost bundle with retained revision fence with original dates and receipts, never policy or access", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest } = fixture;
  const input = assertion("Cedar retained fact");
  const first = await PrivateMemoryRepository.change(actor, input);
  const archive = await PrivateMemoryRepository.backup(actor);
  const before = (await PrivateMemoryRepository.read(actor)).snapshot;
  await queries.query(sql`UPDATE workspace_memory_namespace SET enabled = false
    WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
  // Fault injection only into this synthetic owner's disposable projection.
  await queries.query(sql`UPDATE private_memory_repository SET head_sha=NULL,bundle=NULL,recorded_at=NULL
    WHERE namespace_id IN (SELECT namespace_id FROM workspace_memory_namespace WHERE workspace_id=${actor.workspaceId} AND user_id=${actor.userId})`);

  expect(
    await PrivateMemoryRepository.restore(actor, {
      expectedRevision: null,
      archive,
    })
  ).toEqual({ applied: true, revision: first.receipt.revision });
  const restored = await PrivateMemoryRepository.read(actor);
  expect(restored.snapshot).toEqual(before);
  expect(restored.enabled).toBe(false);
  await expect(
    PrivateMemoryRepository.change(actor, input)
  ).rejects.toMatchObject({ reason: "disabled" });
  expect(
    await PrivateMemoryRepository.restore(actor, {
      expectedRevision: null,
      archive,
    })
  ).toEqual({ applied: false, revision: first.receipt.revision });
  await expect(
    PrivateMemoryRepository.restore(guest, { expectedRevision: null, archive })
  ).rejects.toThrow("WorkspaceAccessDenied");
  await expect(
    PrivateMemoryRepository.restore(
      { ...actor, agentGrantId: randomUUID() },
      { expectedRevision: null, archive }
    )
  ).rejects.toThrow("WorkspaceAccessDenied");
});

test("an older backup cannot resurrect notes after correction or clear, including a forged receipt target", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  const first = await PrivateMemoryRepository.change(
    actor,
    assertion("Cedar original fact")
  );
  const old = await PrivateMemoryRepository.backup(actor);
  const cleared = await PrivateMemoryRepository.change(actor, {
    action: "clear",
    operationId: randomUUID(),
    expectedRevision: first.receipt.revision,
  });
  await expect(
    PrivateMemoryRepository.restore(actor, {
      expectedRevision: cleared.receipt.revision,
      archive: old,
    })
  ).rejects.toMatchObject({ reason: "conflict" });
  await expect(
    PrivateMemoryRepository.restore(actor, {
      expectedRevision: cleared.receipt.revision,
      archive: { ...old, revision: cleared.receipt.revision },
    })
  ).rejects.toMatchObject({ reason: "invalid_input" });
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.claims[0]?.file.state
  ).toEqual({ kind: "tombstone" });
});

test("restore rolls back the entire bundle/index on SQL receipt failure and revalidates current source evidence", async () => {
  await using fixture = await workspaceFixture();
  const { actor, repository } = fixture;
  const path = "knowledge/restore-source.md";
  const shared = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes: [{ path, content: "Cedar weekly" }],
  });
  const input = assertion("Cedar weekly");
  await PrivateMemoryRepository.change(actor, {
    ...input,
    body: {
      ...input.body,
      sources: [
        {
          kind: "file",
          path,
          revision: shared.revision,
          excerpt: "Cedar weekly",
        },
      ],
    },
  });
  const archive = await PrivateMemoryRepository.backup(actor);
  await queries.query(sql`UPDATE private_memory_repository SET head_sha=NULL,bundle=NULL,recorded_at=NULL
    WHERE namespace_id IN (SELECT namespace_id FROM workspace_memory_namespace WHERE workspace_id=${actor.workspaceId} AND user_id=${actor.userId})`);
  const original = queries.query;
  const dialect = new PgDialect();
  const spy = vi
    .spyOn(queries, "query")
    .mockImplementation(
      async <Row extends Record<string, unknown>>(
        statement: Parameters<typeof queries.query>[0]
      ): Promise<Row[]> => {
        if (
          dialect
            .sqlToQuery(statement)
            .sql.startsWith("INSERT INTO private_memory_operation")
        )
          throw new queries.SqlError(
            new Error("Synthetic restore receipt failure")
          );
        return original<Row>(statement);
      }
    );
  try {
    await expect(
      PrivateMemoryRepository.restore(actor, {
        expectedRevision: null,
        archive,
      })
    ).rejects.toMatchObject({ reason: "unavailable" });
  } finally {
    spy.mockRestore();
  }
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.revision
  ).toBeNull();
  await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: shared.revision,
    changes: [{ path, content: "Cedar monthly" }],
  });
  await expect(
    PrivateMemoryRepository.restore(actor, { expectedRevision: null, archive })
  ).rejects.toMatchObject({ reason: "invalid_input" });
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.revision
  ).toBeNull();
});

test("restore rejects unsigned content, an erased namespace rebind and blind recovery without a retained revision fence", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  const first = await PrivateMemoryRepository.change(
    actor,
    assertion("Cedar private backup")
  );
  const archive = await PrivateMemoryRepository.backup(actor);
  await expect(
    PrivateMemoryRepository.restore(actor, {
      expectedRevision: first.receipt.revision,
      archive: { ...archive, integrity: "f".repeat(64) },
    })
  ).rejects.toMatchObject({ reason: "invalid_input" });
  await expect(
    PrivateMemoryRepository.restore(actor, {
      expectedRevision: first.receipt.revision,
      archive: { ...archive, namespaceId: randomUUID() },
    })
  ).rejects.toThrow("WorkspaceAccessDenied");
  await queries.query(sql`UPDATE private_memory_repository SET head_sha=NULL,bundle=NULL,recorded_at=NULL
    WHERE namespace_id=${archive.namespaceId}`);
  await queries.query(
    sql`DELETE FROM private_memory_operation WHERE namespace_id=${archive.namespaceId}`
  );
  await expect(
    PrivateMemoryRepository.restore(actor, { expectedRevision: null, archive })
  ).rejects.toMatchObject({ reason: "conflict" });
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.revision
  ).toBeNull();
});

test("a signed exact-head archive repairs corrupted bytes without fabricating a new publication", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  const first = await PrivateMemoryRepository.change(
    actor,
    assertion("Cedar original preserved time")
  );
  const before = (await PrivateMemoryRepository.read(actor)).snapshot;
  const archive = await PrivateMemoryRepository.backup(actor);
  await queries.query(sql`UPDATE private_memory_repository SET bundle=${Buffer.from("corrupt synthetic bytes")}
    WHERE namespace_id=${archive.namespaceId}`);
  await expect(PrivateMemoryRepository.read(actor)).rejects.toBeInstanceOf(
    PrivateMemoryError
  );
  expect(
    await PrivateMemoryRepository.restore(actor, {
      expectedRevision: first.receipt.revision,
      archive,
    })
  ).toEqual({ applied: true, revision: first.receipt.revision });
  expect((await PrivateMemoryRepository.read(actor)).snapshot).toEqual(before);
  expect(
    (await PrivateMemoryRepository.rebuildOperations(actor)).operations
  ).toBe(1);
});

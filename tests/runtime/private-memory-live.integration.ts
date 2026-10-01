import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { privateMemoryFixture } from "./private-memory-fixture";
import {
  capabilitiesPath,
  defaultWorkspaceCapabilities,
} from "../../shared/workspaces/capabilities";

const body = (text: string) => ({
  text,
  sources: [],
  relations: [],
  validTime: null,
});
const assertion = (text: string) => ({
  action: "assert" as const,
  claimId: randomUUID(),
  operationId: randomUUID(),
  expectedRevision: null,
  body: body(text),
});

test("fresh enrollment owns an explicit empty repository; deleted authoritative content never becomes empty success", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const empty = await PrivateMemoryRepository.read(actor);
  expect(empty.snapshot).toMatchObject({
    revision: null,
    recordedAt: null,
    claims: [],
  });
  const namespace = await fixture.namespace(actor);
  expect(
    await query(
      sql`SELECT namespace_id FROM private_memory_repository WHERE namespace_id=${namespace.id}`
    )
  ).toHaveLength(1);
  await query(
    sql`DELETE FROM private_memory_repository WHERE namespace_id=${namespace.id}`
  );
  for (const run of [
    () => PrivateMemoryRepository.read(actor),
    () => PrivateMemoryRepository.search(actor, { query: "Cedar" }),
    () => PrivateMemoryRepository.rebuildOperations(actor),
  ])
    await expect(run()).rejects.toMatchObject({ reason: "unavailable" });
});

test("SQL consent CAS and stable replay cannot re-enable learning after a newer pause", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const initial = await PrivateMemoryRepository.read(actor);
  const pause = {
    operationId: randomUUID(),
    expectedPreferenceRevision: initial.preferenceRevision,
    enabled: false,
  };
  const paused = await PrivateMemoryRepository.setEnabled(actor, pause);
  const enable = {
    operationId: randomUUID(),
    expectedPreferenceRevision: paused.receipt.preferenceRevision,
    enabled: true,
  };
  const enabled = await PrivateMemoryRepository.setEnabled(actor, enable);
  const latest = await PrivateMemoryRepository.setEnabled(actor, {
    operationId: randomUUID(),
    expectedPreferenceRevision: enabled.receipt.preferenceRevision,
    enabled: false,
  });
  expect(await PrivateMemoryRepository.setEnabled(actor, enable)).toEqual({
    applied: false,
    receipt: enabled.receipt,
  });
  const current = await PrivateMemoryRepository.read(actor);
  expect(current).toMatchObject({
    enabled: false,
    workspaceEnabled: true,
    automaticEnabled: false,
    preferenceRevision: latest.receipt.preferenceRevision,
  });
  await expect(
    PrivateMemoryRepository.setEnabled(actor, { ...enable, enabled: false })
  ).rejects.toMatchObject({ reason: "conflict" });
  await expect(
    PrivateMemoryRepository.setEnabled(actor, {
      ...enable,
      operationId: randomUUID(),
    })
  ).rejects.toMatchObject({ reason: "conflict" });
});

test("workspace disablement preserves personal preference; paused review/removal remains authorized", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.actor;
  const change = assertion("Cedar is a reviewed preference");
  const first = await PrivateMemoryRepository.change(actor, change);
  const capabilities = {
    ...defaultWorkspaceCapabilities,
    enabled: defaultWorkspaceCapabilities.enabled.filter(
      (capability) => capability !== "memory"
    ),
  };
  await fixture.repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes: [
      { path: capabilitiesPath, content: JSON.stringify(capabilities) },
    ],
  });
  expect(await PrivateMemoryRepository.read(actor)).toMatchObject({
    enabled: true,
    workspaceEnabled: false,
    automaticEnabled: false,
  });
  expect(
    (await PrivateMemoryRepository.search(actor, { query: "Cedar" })).matches
  ).toHaveLength(1);
  expect(
    await PrivateMemoryRepository.recall(
      actor,
      `scope-${actor.workspaceId}`,
      randomUUID(),
      "Cedar"
    )
  ).toMatchObject({
    enabled: true,
    workspaceEnabled: false,
    automaticEnabled: false,
    matches: [],
    hasMore: false,
  });
  await expect(
    PrivateMemoryRepository.change(actor, {
      ...assertion("new learning denied"),
      expectedRevision: first.receipt.revision,
    })
  ).rejects.toMatchObject({ reason: "disabled" });
  await PrivateMemoryRepository.change(actor, {
    action: "tombstone",
    operationId: randomUUID(),
    claimId: change.claimId,
    expectedRevision: first.receipt.revision,
  });
  expect(
    (await PrivateMemoryRepository.search(actor, { query: "Cedar" })).matches
  ).toEqual([]);
});

test("current and recorded search keep real publication time separate from world-valid time", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const change = assertion("Weekly Cedar reports");
  const first = await PrivateMemoryRepository.change(actor, change);
  if (!first.applied || !("claim" in first))
    throw new Error("Expected first publication");
  const second = await PrivateMemoryRepository.change(actor, {
    action: "correct",
    operationId: randomUUID(),
    claimId: change.claimId,
    expectedRevision: first.receipt.revision,
    body: body("Monthly Cedar reports"),
  });
  const current = await PrivateMemoryRepository.search(actor, {
    query: "reports",
  });
  expect(current.revision).toBe(second.receipt.revision);
  expect(current.matches[0]?.claim.file.state).toEqual({
    kind: "active",
    body: body("Monthly Cedar reports"),
  });
  const recorded = await PrivateMemoryRepository.search(actor, {
    query: "reports",
    view: { asOf: first.claim.recordedAt },
    validOn: "1900-01-01",
  });
  expect(recorded).toMatchObject({
    revision: first.receipt.revision,
    recordedAt: first.claim.recordedAt,
  });
  expect(recorded.matches[0]).toMatchObject({
    claim: first.claim,
    validity: "unknown",
  });
  await expect(
    PrivateMemoryRepository.search(actor, {
      query: "x",
      view: { asOf: first.claim.recordedAt, revision: first.receipt.revision },
    })
  ).rejects.toMatchObject({ reason: "invalid_input" });
});

test("real concurrent claim CAS admits one publication and source receipts never override Git replay", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  await PrivateMemoryRepository.read(actor);
  const changes = [assertion("Cedar winner"), assertion("Maple winner")];
  const results = await Promise.allSettled(
    changes.map((change) => PrivateMemoryRepository.change(actor, change))
  );
  expect(
    results.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
    reason: "conflict",
  });
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.claims
  ).toHaveLength(1);
});

test("an actual SQL receipt collision rolls back the head and leaves the prior recall replay intact", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const initial = assertion("Weekly Cedar preference");
  const first = await PrivateMemoryRepository.change(actor, initial);
  const namespace = await fixture.namespace(actor);
  const scopeKey = `scope-${actor.workspaceId}`;
  const recallId = randomUUID();
  const recalled = await PrivateMemoryRepository.recall(
    actor,
    scopeKey,
    recallId,
    "Cedar"
  );
  const next = {
    action: "correct" as const,
    operationId: randomUUID(),
    claimId: initial.claimId,
    expectedRevision: first.receipt.revision,
    body: body("Monthly Cedar preference"),
  };
  // Corrupt only this rebuildable SQL index. The real unique constraint fails
  // after head publication, so PostgreSQL must roll the whole mutation back.
  await query(sql`INSERT INTO private_memory_operation(namespace_id,operation_id,revision,parent_revision,claim_id,request_hash,author_user_id,recorded_at)
    VALUES (${namespace.id},${next.operationId},${"c".repeat(40)},${first.receipt.revision},${initial.claimId},${"d".repeat(64)},${actor.userId},clock_timestamp())`);
  await expect(
    PrivateMemoryRepository.change(actor, next)
  ).rejects.toMatchObject({ reason: "unavailable" });
  expect((await PrivateMemoryRepository.read(actor)).snapshot.revision).toBe(
    first.receipt.revision
  );
  expect(
    await PrivateMemoryRepository.recall(actor, scopeKey, recallId, "Cedar")
  ).toEqual(recalled);
  await query(
    sql`DELETE FROM private_memory_operation WHERE namespace_id=${namespace.id} AND operation_id=${next.operationId}`
  );
  expect((await PrivateMemoryRepository.change(actor, next)).applied).toBe(
    true
  );
});

test("person/workspace isolation and current revocation fence explicit and automatic output", async () => {
  await using fixture = await privateMemoryFixture();
  const first = await PrivateMemoryRepository.change(
    fixture.actor,
    assertion("Owner private Cedar")
  );
  await PrivateMemoryRepository.change(
    fixture.guest,
    assertion("Guest private Maple")
  );
  expect(
    (await PrivateMemoryRepository.search(fixture.guest, { query: "Cedar" }))
      .matches
  ).toEqual([]);
  expect(
    (await PrivateMemoryRepository.search(fixture.personal, { query: "Cedar" }))
      .matches
  ).toEqual([]);
  await expect(
    PrivateMemoryRepository.read(fixture.guest, {
      revision: first.receipt.revision,
    })
  ).rejects.toMatchObject({ reason: "invalid_input" });
  await expect(
    PrivateMemoryRepository.read({
      ...fixture.actor,
      agentGrantId: randomUUID(),
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id=${fixture.actor.workspaceId} AND user_id=${fixture.actor.userId}`
  );
  await expect(
    PrivateMemoryRepository.search(fixture.actor, { query: "Cedar" })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("a lost head keeps its operational high-water fence and index repair cannot turn it into empty memory", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  await PrivateMemoryRepository.change(
    actor,
    assertion("Cedar survives projection loss")
  );
  const archive = await PrivateMemoryRepository.backup(actor);
  const namespace = await fixture.namespace(actor);
  await query(
    sql`UPDATE private_memory_repository SET head_sha=NULL,bundle=NULL,recorded_at=NULL WHERE namespace_id=${namespace.id}`
  );
  await expect(PrivateMemoryRepository.read(actor)).rejects.toMatchObject({
    reason: "unavailable",
  });
  await expect(
    PrivateMemoryRepository.rebuildOperations(actor)
  ).rejects.toMatchObject({ reason: "unavailable" });
  expect(
    await query(
      sql`SELECT revision FROM private_memory_operation WHERE namespace_id=${namespace.id}`
    )
  ).toHaveLength(1);
  expect(
    await PrivateMemoryRepository.restore(actor, {
      expectedRevision: null,
      archive,
    })
  ).toMatchObject({ applied: true, revision: archive.revision });
  expect((await PrivateMemoryRepository.read(actor)).snapshot.revision).toBe(
    archive.revision
  );
});

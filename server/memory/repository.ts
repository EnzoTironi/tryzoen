import { PrivateMemoryError } from "./errors";
import { verifyEvidence, verifySources } from "./evidence";
import { LearnedClaimError } from "./claims";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { projectLearnedClaims, searchLearnedClaims } from "./retrieval";
import { query, transaction, SqlError } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  LearnedClaimChangeSchema,
  LearnedClaimRecallSchema,
  learnedClaimLimits,
  LearnedClaimReceiptSchema,
  LearnedClaimScopeSchema,
} from "../../packages/companion-ui/src/learned/claim";
import {
  LearnedClaimReadSchema,
  LearnedClaimSearchInputSchema,
  LearnedClaimSearchSchema,
  LearnedClaimHistorySchema,
  LearnedClaimSetEnabledInputSchema,
  LearnedClaimSetEnabledResultSchema,
  LearnedClaimPreferenceReceiptSchema,
  LearnedClaimChangeResultSchema,
  PrivateMemoryArchivePreviewSchema,
} from "../../packages/companion-ui/src/learned/schema";
import {
  GitRevisionSchema,
  WorkspaceRecordedViewSchema,
} from "../../packages/companion-ui/src/library/files-schema";
import {
  WorkspaceActorSchema,
  WorkspaceAccessDenied,
  requireWorkspaceAccess,
} from "../workspaces/access";
import { GitBundleError } from "../files/git";
import {
  memoryNamespace,
  MemoryNamespaceError,
  isMemoryNamespaceErased,
} from "./namespace";
import { publishPrivateMemoryGit, readPrivateMemoryGit } from "./git";
import {
  SessionArchiveUnavailable,
  backupSessionClaimSources,
  restoreSessionClaimSources,
  backupCompleteSessionSources,
  restoreCompleteSessionSources,
  inspectSessionSourceArchive,
} from "./session-export";

import {
  PrivateMemoryBackupSchema,
  PrivateMemoryCorpusBackupSchema,
  PrivateMemoryArchiveError,
  type PrivateMemoryArchiveSchema,
  copyPrivateMemoryArchive,
  sealPrivateMemoryArchive,
  requirePrivateMemoryArchiveAuthentication,
  privateMemoryArchiveDigest,
} from "./archive";
export {
  PrivateMemoryBackupSchema,
  PrivateMemoryCorpusBackupSchema,
} from "./archive";
import { decodePrivateMemoryArchive } from "./archive-codec";
import { PayloadError } from "../payloads/contract";
import {
  adoptPayload,
  putRegistered,
  readPayload,
  registerPayload,
} from "../payloads/publication";

const storedSchema = z.object({
  head: GitRevisionSchema.nullable(),
  bundle: z.instanceof(Uint8Array).nullable(),
});

async function privateScope(
  raw: z.infer<typeof WorkspaceActorSchema>,
  scopeKey?: string
) {
  const actor = WorkspaceActorSchema.parse(raw);
  if (
    actor.agentGrantId ||
    actor.protocolTaskId ||
    actor.scheduledRunId ||
    actor.groupBindingId ||
    actor.groupEpoch
  )
    throw new WorkspaceAccessDenied();
  await requireWorkspaceAccess(actor);
  const namespace = await memoryNamespace(actor, scopeKey);
  return {
    actor,
    scope: LearnedClaimScopeSchema.parse({
      workspaceId: actor.workspaceId,
      userId: actor.userId,
    }),
    namespace,
  };
}

async function stored(
  namespaceId: string,
  purpose: "read" | "restore" = "read"
) {
  const rows =
    await query(sql`SELECT r.head_sha AS head,r.payload_object_id AS "payloadId",n.workspace_id AS "workspaceId",n.user_id AS "userId"
    FROM private_memory_repository r JOIN workspace_memory_namespace n ON n.namespace_id=r.namespace_id
    WHERE r.namespace_id = ${namespaceId} FOR SHARE OF r,n`);
  if (!rows[0]) throw new PrivateMemoryError("unavailable");
  const pointer = z
    .object({
      head: GitRevisionSchema.nullable(),
      payloadId: z.uuid().nullable(),
      workspaceId: z.string(),
      userId: z.string(),
    })
    .parse(rows[0]);
  if ((pointer.head === null) !== (pointer.payloadId === null))
    throw new PrivateMemoryError("unavailable");
  const bundle =
    pointer.payloadId === null
      ? null
      : await readPayload(
          {
            workspaceId: pointer.workspaceId,
            ownerGeneration: namespaceId,
            ownerUserId: pointer.userId,
            kind: "private-memory-bundle",
          },
          pointer.payloadId
        ).catch((error: unknown) => {
          // Only an authenticated archive may replace missing or corrupt bytes.
          // The retained head still fences lineage; provider outages never do.
          if (
            purpose === "restore" &&
            error instanceof PayloadError &&
            (error.reason === "missing" || error.reason === "corrupt")
          )
            return null;
          throw error;
        });
  const repository = storedSchema.parse({ ...pointer, bundle });
  if (repository.head === null && purpose === "read") {
    const [receipt] =
      await query(sql`SELECT revision FROM private_memory_operation WHERE namespace_id=${namespaceId}
      ORDER BY recorded_at DESC LIMIT 1`);
    if (receipt) throw new PrivateMemoryError("unavailable");
  }
  return repository;
}

async function recordOperation(
  namespaceId: string,
  entry: Awaited<ReturnType<typeof readPrivateMemoryGit>>["operations"][number]
) {
  const { revision, operation } = entry;
  await query(sql`INSERT INTO private_memory_operation
    (namespace_id, operation_id, revision, parent_revision, claim_id, request_hash, author_user_id, recorded_at)
    VALUES (${namespaceId}, ${operation.operationId}, ${revision}, ${operation.parentRevision}, ${operation.claimId},
      ${operation.requestHash}, ${operation.authorUserId}, ${operation.recordedAt}::timestamptz)`);
}

async function authorized<Result>(
  run: () => Promise<Result>,
  options?: Parameters<typeof transaction>[1]
) {
  try {
    return await transaction(run, options);
  } catch (error) {
    return privateFailure(error);
  }
}

function privateFailure(error: unknown): never {
  if (
    error instanceof PrivateMemoryError ||
    error instanceof WorkspaceAccessDenied
  )
    throw error;
  if (error instanceof LearnedClaimError)
    throw new PrivateMemoryError(error.reason);
  if (error instanceof PrivateMemoryArchiveError)
    throw new PrivateMemoryError(error.reason);
  if (error instanceof MemoryNamespaceError)
    throw new PrivateMemoryError(
      error.reason === "erased" ? "conflict" : "invalid_input"
    );
  if (error instanceof GitBundleError && error.reason === "invalid_file")
    throw new PrivateMemoryError("invalid_input");
  if (
    error instanceof GitBundleError ||
    error instanceof SqlError ||
    error instanceof PayloadError ||
    error instanceof SessionArchiveUnavailable
  )
    throw new PrivateMemoryError("unavailable", { cause: error });
  if (error instanceof z.ZodError)
    throw new PrivateMemoryError("invalid_input");
  throw error;
}

async function captureClaims(
  owner: Awaited<ReturnType<typeof privateScope>>,
  view: z.infer<typeof WorkspaceRecordedViewSchema>
) {
  const repository = await stored(owner.namespace.id);
  const cutoff = view.asOf
    ? (
        await query<{ value: string }>(
          sql`SELECT to_char(${view.asOf}::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`
        )
      )[0]?.value
    : undefined;
  if (view.asOf && !cutoff) throw new PrivateMemoryError("invalid_input");
  const captured = await readPrivateMemoryGit({
    scope: owner.scope,
    ...repository,
    revision: view.revision,
    recordedThrough: cutoff,
  });
  await verifyEvidence(
    owner.actor,
    captured.snapshot.claims.map((claim) => claim.file),
    !view.revision && !view.asOf
  );
  await requireWorkspaceAccess(owner.actor);
  return LearnedClaimReadSchema.parse({
    snapshot: captured.snapshot,
    enabled: owner.namespace.enabled,
    workspaceEnabled: owner.namespace.workspaceEnabled,
    automaticEnabled: owner.namespace.automaticEnabled,
    preferenceRevision: owner.namespace.preferenceRevision,
  });
}

async function verifyRestorableArchive(
  actor: z.infer<typeof WorkspaceActorSchema>,
  archive: z.infer<typeof PrivateMemoryArchiveSchema>
) {
  if (!actor.authSessionId || actor.channelIdentityId || actor.matrixIdentityId)
    throw new WorkspaceAccessDenied();
  const owner = await privateScope(actor);
  if (
    archive.scope.workspaceId !== owner.scope.workspaceId ||
    archive.scope.userId !== owner.scope.userId ||
    archive.namespaceId !== owner.namespace.id
  )
    throw new WorkspaceAccessDenied();
  requirePrivateMemoryArchiveAuthentication(archive);
  // A receipt can coexist with a namespace after coordinated DB recovery.
  // Check its presence under the namespace lock before reading retained history.
  if (await isMemoryNamespaceErased(owner.namespace.id))
    throw new PrivateMemoryError("conflict");
  const current = await stored(owner.namespace.id, "restore");
  const restored = await readPrivateMemoryGit({
    scope: owner.scope,
    head: archive.revision,
    bundle: archive.bundle,
    includeRetainedSources: true,
  });
  // Retained history may advance the lineage or rebuild a lost projection,
  // but must never roll back a later correction/tombstone or diverge from it.
  if (
    current.head !== null &&
    !restored.operations.some((entry) => entry.revision === current.head)
  )
    throw new PrivateMemoryError("conflict");
  if (current.head === null && archive.revision !== null) {
    // If both head and receipts are lost, only a coordinated installation
    // backup can recover the authority needed to restore these facts.
    const [latest] =
      await query(sql`SELECT revision FROM private_memory_operation
        WHERE namespace_id = ${owner.namespace.id} ORDER BY recorded_at DESC LIMIT 1`);
    if (latest?.revision !== archive.revision)
      throw new PrivateMemoryError("conflict");
  }
  await verifySources(
    owner.actor,
    restored.retainedSources.filter((source) => source.kind === "file"),
    false
  );
  await verifySources(
    owner.actor,
    restored.snapshot.claims
      .flatMap((claim) =>
        claim.file.state.kind === "active" ? claim.file.state.body.sources : []
      )
      .filter((source) => source.kind === "file"),
    true
  );
  // Archive metadata never reconstructs or resets the retained capture fence.
  if (
    archive.version === 3 &&
    (archive.sources.length > owner.namespace.journalEventCount ||
      (archive.capturedThrough !== null &&
        (owner.namespace.journalHighWater === null ||
          archive.capturedThrough > owner.namespace.journalHighWater)))
  )
    throw new PrivateMemoryError("conflict");
  return {
    owner,
    current,
    restored,
    citations: restored.retainedSources.filter(
      (source) => source.kind === "session"
    ),
  };
}

function restoreArchive(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: {
    expectedRevision: string | null;
    archive: z.infer<typeof PrivateMemoryArchiveSchema>;
  },
  expectedVersion: 2 | 3
) {
  let archive: z.infer<typeof PrivateMemoryArchiveSchema>;
  let expected: string | null;
  try {
    // Old v1 artifacts remain untouched but are intentionally unsupported.
    // Freeze caller-owned bytes before the first asynchronous boundary.
    expected = GitRevisionSchema.nullable().parse(input.expectedRevision);
    archive = copyPrivateMemoryArchive(input.archive);
    if (archive.version !== expectedVersion)
      throw new PrivateMemoryError("invalid_input");
  } catch {
    return Promise.reject(new PrivateMemoryError("invalid_input"));
  }
  async function repairSources(
    checked: Awaited<ReturnType<typeof verifyRestorableArchive>>
  ) {
    if (archive.version === 3)
      await restoreCompleteSessionSources(
        checked.owner.actor,
        checked.owner.namespace.id,
        checked.citations,
        archive.sources
      );
    else
      await restoreSessionClaimSources(
        checked.owner.actor,
        checked.owner.namespace.id,
        checked.citations,
        archive.sources
      );
  }
  function sameBundle(current: Awaited<ReturnType<typeof stored>>) {
    return (
      current.head === archive.revision &&
      (current.bundle === null
        ? archive.bundle === null
        : archive.bundle !== null &&
          Buffer.from(current.bundle).equals(Buffer.from(archive.bundle)))
    );
  }
  return Promise.try(async () => {
    const initial = await authorized(
      async () => {
        const checked = await verifyRestorableArchive(actor, archive);
        const { owner, current } = checked;
        await requireWorkspaceAccess(owner.actor);
        if (current.head !== archive.revision && current.head !== expected)
          throw new PrivateMemoryError("conflict");
        if (sameBundle(current)) {
          await repairSources(checked);
          return { kind: "replayed" as const, revision: current.head };
        }
        const reference =
          archive.bundle === null
            ? null
            : await registerPayload(
                {
                  workspaceId: owner.scope.workspaceId,
                  ownerGeneration: owner.namespace.id,
                  ownerUserId: owner.scope.userId,
                  kind: "private-memory-bundle",
                },
                archive.bundle
              );
        return {
          kind: "candidate" as const,
          head: current.head,
          namespaceId: owner.namespace.id,
          preferenceRevision: owner.namespace.preferenceRevision,
          reference,
        };
      },
      { outermost: true }
    );
    if (initial.kind === "replayed")
      return { applied: false as const, revision: initial.revision };
    if (initial.reference !== null && archive.bundle !== null)
      await putRegistered(initial.reference, archive.bundle);
    return authorized(
      async () => {
        const checked = await verifyRestorableArchive(actor, archive);
        const { owner, current, restored } = checked;
        if (
          owner.namespace.id !== initial.namespaceId ||
          owner.namespace.preferenceRevision !== initial.preferenceRevision
        )
          throw new PrivateMemoryError("conflict");
        await requireWorkspaceAccess(owner.actor);
        if (sameBundle(current)) {
          await repairSources(checked);
          return { applied: false as const, revision: current.head };
        }
        if (current.head !== initial.head)
          throw new PrivateMemoryError("conflict");
        await repairSources(checked);
        if (initial.reference !== null) await adoptPayload(initial.reference);
        const written =
          await query(sql`UPDATE private_memory_repository SET head_sha=${archive.revision},payload_object_id=${initial.reference?.candidateId ?? null},
        recorded_at=${restored.snapshot.recordedAt}::timestamptz WHERE namespace_id=${owner.namespace.id}
        AND head_sha IS NOT DISTINCT FROM ${current.head} RETURNING namespace_id`);
        if (written.length !== 1) throw new PrivateMemoryError("conflict");
        await query(
          sql`DELETE FROM private_memory_operation WHERE namespace_id=${owner.namespace.id}`
        );
        for (const entry of restored.operations.toReversed())
          await recordOperation(owner.namespace.id, entry);
        await query(
          sql`UPDATE workspace_memory_recall SET snapshot=NULL WHERE namespace_id=${owner.namespace.id}`
        );
        return { applied: true as const, revision: archive.revision };
      },
      { outermost: true }
    );
  }).catch(privateFailure);
}

/** Inspection authenticates the same immutable bytes and recovery fences as apply.
 * It never restores source files, receipts, preference or identity authority. */
export async function inspectPrivateMemoryArchive(
  actor: z.infer<typeof WorkspaceActorSchema>,
  bytes: Uint8Array
) {
  let archive: z.infer<typeof PrivateMemoryArchiveSchema>;
  let archiveDigest: string;
  try {
    archive = decodePrivateMemoryArchive(bytes);
    archiveDigest = privateMemoryArchiveDigest(bytes);
  } catch (error) {
    if (error instanceof PrivateMemoryArchiveError)
      throw new PrivateMemoryError(error.reason);
    throw error;
  }
  return authorized(async () => {
    const { owner, current, restored, citations } =
      await verifyRestorableArchive(actor, archive);
    await inspectSessionSourceArchive(
      owner.actor,
      owner.namespace.id,
      citations,
      archive.sources,
      archive.version === 2 ? "claims" : "complete-journal"
    );
    await requireWorkspaceAccess(owner.actor);
    const preview = {
      namespaceId: archive.namespaceId,
      scope: archive.scope,
      revision: archive.revision,
      expectedRevision: current.head,
      archiveDigest,
      claimCount: restored.snapshot.claims.length,
      sourceEvents: archive.sources.length,
      sourceBytes: archive.sources.reduce(
        (total, source) => total + source.content.byteLength,
        0
      ),
      retainedHistory: true as const,
    };
    return PrivateMemoryArchivePreviewSchema.parse(
      archive.version === 2
        ? { ...preview, version: 2, coverage: "claims" }
        : {
            ...preview,
            version: 3,
            coverage: "complete-journal",
            capturedThrough: archive.capturedThrough,
          }
    );
  });
}

/** No group/export/router reaches this owner through WorkspaceRepository. Scope
 * always comes from the authenticated private principal and current membership. */
export const PrivateMemoryRepository = {
  read(
    actor: z.infer<typeof WorkspaceActorSchema>,
    raw: z.infer<typeof WorkspaceRecordedViewSchema> = {}
  ) {
    return authorized(async () => {
      const view = WorkspaceRecordedViewSchema.parse(raw);
      const owner = await privateScope(actor);
      return captureClaims(owner, view);
    });
  },
  search(
    actor: z.infer<typeof WorkspaceActorSchema>,
    raw: z.infer<typeof LearnedClaimSearchInputSchema>
  ) {
    return authorized(async () => {
      const input = LearnedClaimSearchInputSchema.parse(raw);
      const owner = await privateScope(actor);
      const captured = await captureClaims(owner, input.view ?? {});
      const projection = projectLearnedClaims(owner.scope, captured.snapshot);
      const found = searchLearnedClaims({
        scope: owner.scope,
        current: captured.snapshot,
        projection,
        query: input.query,
        validOn: input.validOn,
        limit: input.limit,
      });
      const value = LearnedClaimSearchSchema.parse({
        enabled: captured.enabled,
        workspaceEnabled: captured.workspaceEnabled,
        automaticEnabled: captured.automaticEnabled,
        preferenceRevision: captured.preferenceRevision,
        revision: captured.snapshot.revision,
        recordedAt: captured.snapshot.recordedAt,
        sourceDigest: projection.sourceDigest,
        matches: found.matches,
        hasMore: found.hasMore,
      });
      if (
        Buffer.byteLength(JSON.stringify(value)) >
        learnedClaimLimits.resultBytes
      )
        throw new PrivateMemoryError("invalid_input");
      return value;
    });
  },
  recall(
    actor: z.infer<typeof WorkspaceActorSchema>,
    scopeKey: string,
    operationId: string,
    rawQuery: string
  ) {
    return authorized(async () => {
      const owner = await privateScope(actor, scopeKey);
      const id =
        LearnedClaimChangeSchema.options[0].shape.operationId.parse(
          operationId
        );
      const text = z
        .string()
        .max(learnedClaimLimits.queryCharacters)
        .parse(rawQuery);
      // Reauthorize and reverify source evidence even on an unchanged Git head or
      // a retry. A persisted recall never acts as a permission/citation cache.
      const captured = await captureClaims(owner, {});
      const projection = projectLearnedClaims(owner.scope, captured.snapshot);
      const found = captured.automaticEnabled
        ? searchLearnedClaims({
            scope: owner.scope,
            current: captured.snapshot,
            projection,
            query: text,
          })
        : { matches: [], hasMore: false };
      const value = LearnedClaimRecallSchema.parse({
        enabled: captured.enabled,
        workspaceEnabled: captured.workspaceEnabled,
        automaticEnabled: captured.automaticEnabled,
        preferenceRevision: captured.preferenceRevision,
        revision: captured.snapshot.revision,
        sourceDigest: projection.sourceDigest,
        queryHash: createHash("sha256").update(text).digest("hex"),
        matches: found.matches,
        hasMore: found.hasMore,
      });
      if (
        Buffer.byteLength(JSON.stringify(value)) >
        learnedClaimLimits.resultBytes
      )
        throw new PrivateMemoryError("invalid_input");
      const rows = await query(sql`SELECT snapshot FROM workspace_memory_recall
        WHERE namespace_id = ${owner.namespace.id} AND operation_id = ${id}`);
      if (rows[0]) {
        const previous = LearnedClaimRecallSchema.safeParse(rows[0].snapshot);
        if (!previous.success || !isDeepStrictEqual(previous.data, value))
          throw new PrivateMemoryError("stale_recall");
        return previous.data;
      }
      await query(sql`INSERT INTO workspace_memory_recall (namespace_id, operation_id, snapshot)
        VALUES (${owner.namespace.id}, ${id}, ${JSON.stringify(value)}::jsonb)`);
      // Expiring only derived payloads retains the operation receipt. Replaying
      // an expired request must fail rather than fetch a newer set of facts.
      await query(sql`UPDATE workspace_memory_recall SET snapshot = NULL
        WHERE namespace_id = ${owner.namespace.id} AND created_at < now() - interval '7 days'
          AND snapshot IS NOT NULL`);
      await requireWorkspaceAccess(owner.actor);
      return value;
    });
  },
  async change(
    actor: z.infer<typeof WorkspaceActorSchema>,
    raw: z.infer<typeof LearnedClaimChangeSchema>
  ) {
    try {
      const change = LearnedClaimChangeSchema.parse(raw);
      const initial = await authorized(
        async () => {
          const owner = await privateScope(actor);
          if (!owner.namespace.automaticEnabled && change.action === "assert")
            throw new PrivateMemoryError("disabled");
          const repository = await stored(owner.namespace.id);
          const result = await publishPrivateMemoryGit({
            scope: owner.scope,
            bundle: repository.bundle,
            head: repository.head,
            change,
            publication: async () => {
              const rows = await query<{
                recordedAt: string;
              }>(sql`SELECT to_char(
              GREATEST(clock_timestamp(), COALESCE(recorded_at + interval '1 microsecond', '-infinity'::timestamptz))
                AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "recordedAt"
              FROM private_memory_repository WHERE namespace_id = ${owner.namespace.id}`);
              if (!rows[0]) throw new PrivateMemoryError("unavailable");
              return {
                recordedAt: rows[0].recordedAt,
                authorUserId: owner.scope.userId,
              };
            },
          });
          if (!result.applied)
            return {
              kind: "replayed" as const,
              receipt: LearnedClaimReceiptSchema.parse(result.receipt),
            };
          await verifyEvidence(
            owner.actor,
            "claim" in result
              ? [result.claim.file]
              : result.cleared.map((claim) => claim.file),
            true
          );
          const reference = await registerPayload(
            {
              workspaceId: owner.scope.workspaceId,
              ownerGeneration: owner.namespace.id,
              ownerUserId: owner.scope.userId,
              kind: "private-memory-bundle",
            },
            result.bundle
          );
          return {
            kind: "candidate" as const,
            reference,
            result,
            head: repository.head,
            namespaceId: owner.namespace.id,
            preferenceRevision: owner.namespace.preferenceRevision,
          };
        },
        { outermost: true }
      );
      if (initial.kind === "replayed")
        return { applied: false as const, receipt: initial.receipt };
      await putRegistered(initial.reference, initial.result.bundle);
      return await authorized(
        async () => {
          const owner = await privateScope(actor);
          if (
            owner.namespace.id !== initial.namespaceId ||
            owner.namespace.preferenceRevision !== initial.preferenceRevision
          )
            throw new PrivateMemoryError("conflict");
          if (!owner.namespace.automaticEnabled && change.action === "assert")
            throw new PrivateMemoryError("disabled");
          const current = await stored(owner.namespace.id);
          if (current.head !== initial.head) {
            const replay = await publishPrivateMemoryGit({
              scope: owner.scope,
              bundle: current.bundle,
              head: current.head,
              change,
              publication: async () => {
                throw new PrivateMemoryError("conflict");
              },
            });
            if (replay.applied) throw new PrivateMemoryError("conflict");
            return {
              applied: false as const,
              receipt: LearnedClaimReceiptSchema.parse(replay.receipt),
            };
          }
          const result = initial.result;
          await verifyEvidence(
            owner.actor,
            "claim" in result
              ? [result.claim.file]
              : result.cleared.map((claim) => claim.file),
            true
          );
          await requireWorkspaceAccess(owner.actor);
          await adoptPayload(initial.reference);
          const published = await query(sql`UPDATE private_memory_repository SET
          head_sha=${result.receipt.revision},payload_object_id=${initial.reference.candidateId},recorded_at=${result.snapshot.recordedAt}::timestamptz
          WHERE namespace_id=${owner.namespace.id} AND head_sha IS NOT DISTINCT FROM ${change.expectedRevision} RETURNING namespace_id`);
          if (published.length !== 1) throw new PrivateMemoryError("conflict");
          await recordOperation(owner.namespace.id, {
            revision: result.receipt.revision,
            operation: result.operation,
          });
          await query(
            sql`UPDATE workspace_memory_recall SET snapshot=NULL WHERE namespace_id=${owner.namespace.id}`
          );
          return LearnedClaimChangeResultSchema.parse(
            "claim" in result
              ? {
                  applied: true as const,
                  receipt: result.receipt,
                  claim: result.claim,
                }
              : {
                  applied: true as const,
                  receipt: result.receipt,
                  cleared: result.cleared,
                }
          );
        },
        { outermost: true }
      );
    } catch (error) {
      return privateFailure(error);
    }
  },
  history(actor: z.infer<typeof WorkspaceActorSchema>, claimId: string) {
    return authorized(async () => {
      const id = z.uuid().parse(claimId);
      const owner = await privateScope(actor);
      const repository = await stored(owner.namespace.id);
      const captured = await readPrivateMemoryGit({
        scope: owner.scope,
        ...repository,
        historyClaimId: id,
      });
      await verifyEvidence(
        owner.actor,
        captured.history.map((claim) => claim.file),
        false
      );
      await requireWorkspaceAccess(owner.actor);
      return LearnedClaimHistorySchema.parse({
        revision: repository.head,
        versions: captured.history,
      });
    });
  },
  setEnabled(
    actor: z.infer<typeof WorkspaceActorSchema>,
    raw: z.infer<typeof LearnedClaimSetEnabledInputSchema>
  ) {
    return authorized(async () => {
      const input = LearnedClaimSetEnabledInputSchema.parse(raw);
      const owner = await privateScope(actor);
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ scope: owner.scope, ...input }))
        .digest("hex");
      const [previous] =
        await query(sql`SELECT operation_id AS "operationId", request_hash AS "requestHash",
        preference_revision AS "preferenceRevision", enabled
        FROM private_memory_preference_operation WHERE namespace_id=${owner.namespace.id}
          AND operation_id=${input.operationId}`);
      if (previous) {
        const receipt = LearnedClaimPreferenceReceiptSchema.parse(previous);
        if (receipt.requestHash !== requestHash)
          throw new PrivateMemoryError("conflict");
        return LearnedClaimSetEnabledResultSchema.parse({
          applied: false,
          receipt,
        });
      }
      if (
        owner.namespace.preferenceRevision !== input.expectedPreferenceRevision
      )
        throw new PrivateMemoryError("conflict");
      const [changed] = await query(sql`UPDATE workspace_memory_namespace
        SET enabled=${input.enabled}, preference_revision=gen_random_uuid()
        WHERE namespace_id=${owner.namespace.id} AND preference_revision=${input.expectedPreferenceRevision}
        RETURNING preference_revision AS "preferenceRevision", enabled`);
      if (!changed) throw new PrivateMemoryError("conflict");
      const receipt = LearnedClaimPreferenceReceiptSchema.parse({
        operationId: input.operationId,
        requestHash,
        ...changed,
      });
      await query(sql`INSERT INTO private_memory_preference_operation
        (namespace_id, operation_id, request_hash, preference_revision, enabled)
        VALUES (${owner.namespace.id},${receipt.operationId},${receipt.requestHash},${receipt.preferenceRevision},${receipt.enabled})`);
      await query(
        sql`UPDATE workspace_memory_recall SET snapshot=NULL WHERE namespace_id=${owner.namespace.id}`
      );
      await requireWorkspaceAccess(owner.actor);
      return LearnedClaimSetEnabledResultSchema.parse({
        applied: true,
        receipt,
      });
    });
  },
  backup(actor: z.infer<typeof WorkspaceActorSchema>) {
    return authorized(async () => {
      if (
        !actor.authSessionId ||
        actor.channelIdentityId ||
        actor.matrixIdentityId
      )
        throw new WorkspaceAccessDenied();
      const owner = await privateScope(actor);
      if (await isMemoryNamespaceErased(owner.namespace.id))
        throw new PrivateMemoryError("conflict");
      const repository = await stored(owner.namespace.id);
      const captured = await readPrivateMemoryGit({
        scope: owner.scope,
        ...repository,
        includeRetainedSources: true,
      });
      // An export cannot bypass current permission on evidence cited by an
      // older correction or a cleared claim. Authorize the complete lineage.
      await verifySources(
        owner.actor,
        captured.retainedSources.filter((source) => source.kind === "file"),
        false
      );
      const sources = await backupSessionClaimSources(
        owner.actor,
        owner.namespace.id,
        captured.retainedSources.filter((source) => source.kind === "session")
      );
      await requireWorkspaceAccess(owner.actor);
      const archive = {
        version: 2 as const,
        sources,
        namespaceId: owner.namespace.id,
        scope: owner.scope,
        revision: repository.head,
        bundle:
          repository.bundle === null
            ? null
            : Uint8Array.from(repository.bundle),
      };
      return PrivateMemoryBackupSchema.parse(sealPrivateMemoryArchive(archive));
    });
  },
  backupCorpus(actor: z.infer<typeof WorkspaceActorSchema>) {
    return authorized(async () => {
      if (
        !actor.authSessionId ||
        actor.channelIdentityId ||
        actor.matrixIdentityId
      )
        throw new WorkspaceAccessDenied();
      const owner = await privateScope(actor);
      const repository = await stored(owner.namespace.id);
      const captured = await readPrivateMemoryGit({
        scope: owner.scope,
        ...repository,
        includeRetainedSources: true,
      });
      // Complete journal export does not relax retained claim citation evidence.
      await verifySources(owner.actor, captured.retainedSources, false);
      const journal = await backupCompleteSessionSources(
        owner.actor,
        owner.namespace.id
      );
      await requireWorkspaceAccess(owner.actor);
      return PrivateMemoryCorpusBackupSchema.parse(
        sealPrivateMemoryArchive({
          version: 3,
          coverage: "complete-journal",
          ...journal,
          namespaceId: owner.namespace.id,
          scope: owner.scope,
          revision: repository.head,
          bundle:
            repository.bundle === null
              ? null
              : Uint8Array.from(repository.bundle),
        })
      );
    });
  },
  async restore(
    actor: z.infer<typeof WorkspaceActorSchema>,
    input: {
      expectedRevision: string | null;
      archive: z.infer<typeof PrivateMemoryBackupSchema>;
    }
  ) {
    return restoreArchive(actor, input, 2);
  },
  async restoreCorpus(
    actor: z.infer<typeof WorkspaceActorSchema>,
    input: {
      expectedRevision: string | null;
      archive: z.infer<typeof PrivateMemoryCorpusBackupSchema>;
    }
  ) {
    return restoreArchive(actor, input, 3);
  },
  rebuildOperations(actor: z.infer<typeof WorkspaceActorSchema>) {
    return authorized(async () => {
      if (
        !actor.authSessionId ||
        actor.channelIdentityId ||
        actor.matrixIdentityId
      )
        throw new WorkspaceAccessDenied();
      const owner = await privateScope(actor);
      const repository = await stored(owner.namespace.id);
      const captured = await readPrivateMemoryGit({
        scope: owner.scope,
        ...repository,
      });
      // Only rebuildable indexes change; files, namespace permissions and heads remain.
      await query(
        sql`DELETE FROM private_memory_operation WHERE namespace_id = ${owner.namespace.id}`
      );
      for (const entry of captured.operations.toReversed())
        await recordOperation(owner.namespace.id, entry);
      await requireWorkspaceAccess(owner.actor);
      return {
        revision: repository.head,
        operations: captured.operations.length,
      };
    });
  },
};

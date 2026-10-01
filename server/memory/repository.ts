import { LearnedClaimError } from "./claims";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { projectLearnedClaims, searchLearnedClaims } from "./retrieval";
import { query, transaction, SqlError } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  LearnedClaimChangeSchema,
  type LearnedClaimBodySchema,
  LearnedClaimRecallSchema,
  learnedClaimLimits,
  type LearnedClaimFileSchema,
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
import { WorkspaceRepository } from "../workspaces/repository";
import { GitBundleError } from "../files/git";
import { memoryNamespace, MemoryNamespaceError } from "./namespace";
import { publishPrivateMemoryGit, readPrivateMemoryGit } from "./git";
import {
  verifySessionClaimSource,
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
  PrivateMemoryArchiveSchema,
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

export class PrivateMemoryError extends Error {
  readonly _tag = "PrivateMemoryError";
  constructor(
    readonly reason:
      | "conflict"
      | "invalid_input"
      | "unavailable"
      | "disabled"
      | "stale_recall"
  ) {
    super("PrivateMemoryError");
    this.name = "PrivateMemoryError";
  }
}
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

async function stored(namespaceId: string, allowMissingHead = false) {
  const rows = await query(sql`SELECT head_sha AS head, bundle
    FROM private_memory_repository WHERE namespace_id = ${namespaceId}`);
  if (!rows[0]) throw new PrivateMemoryError("unavailable");
  const repository = storedSchema.parse(rows[0]);
  if (repository.head === null && !allowMissingHead) {
    const [receipt] =
      await query(sql`SELECT revision FROM private_memory_operation WHERE namespace_id=${namespaceId}
      ORDER BY recorded_at DESC LIMIT 1`);
    if (receipt) throw new PrivateMemoryError("unavailable");
  }
  return repository;
}

/** Source formatting never establishes access. Current recall also withholds
 * claims whose cited passage has changed; explicit audit keeps recorded facts. */
async function verifyEvidence(
  actor: z.infer<typeof WorkspaceActorSchema>,
  files: readonly z.infer<typeof LearnedClaimFileSchema>[],
  current: boolean
) {
  const sources = files.flatMap((file) =>
    file.state.kind === "active" ? file.state.body.sources : []
  );
  return verifySources(actor, sources, current);
}

async function verifySources(
  actor: z.infer<typeof WorkspaceActorSchema>,
  sources: readonly z.infer<typeof LearnedClaimBodySchema>["sources"][number][],
  current: boolean
) {
  for (const source of sources.filter((item) => item.kind === "session"))
    if (!(await verifySessionClaimSource(actor, source)))
      throw new PrivateMemoryError("invalid_input");
  const filesSources = sources.filter((source) => source.kind === "file");
  for (const revision of new Set(
    filesSources.map((source) => source.revision)
  )) {
    const citations = filesSources.filter(
      (source) => source.revision === revision
    );
    const paths = [...new Set(citations.map((source) => source.path))];
    for (let offset = 0; offset < paths.length; offset += 24) {
      const selected = paths.slice(offset, offset + 24);
      const recorded = await WorkspaceRepository.selection(actor, selected, {
        revision,
      });
      const latest = current
        ? await WorkspaceRepository.selection(actor, selected)
        : recorded;
      for (const source of citations.filter((item) =>
        selected.includes(item.path)
      )) {
        if (
          !recorded.documents
            .find((item) => item.path === source.path)
            ?.content.includes(source.excerpt) ||
          !latest.documents
            .find((item) => item.path === source.path)
            ?.content.includes(source.excerpt)
        )
          throw new PrivateMemoryError("invalid_input");
      }
    }
  }
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
      error instanceof SessionArchiveUnavailable
    )
      throw new PrivateMemoryError("unavailable");
    if (error instanceof z.ZodError)
      throw new PrivateMemoryError("invalid_input");
    throw error;
  }
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
  return authorized(
    async () => {
      if (
        !actor.authSessionId ||
        actor.channelIdentityId ||
        actor.matrixIdentityId
      )
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
      // A presence read cannot wait behind a worker and miss its row after deletion.
      // The namespace lock already fences ordinary deletion/enrollment.
      const erasure =
        await query(sql`SELECT namespace_id FROM workspace_memory_erasure
        WHERE namespace_id = ${owner.namespace.id}`);
      if (erasure.length) throw new PrivateMemoryError("conflict");
      const current = await stored(owner.namespace.id, true);
      const restored = await readPrivateMemoryGit({
        scope: owner.scope,
        head: archive.revision,
        bundle: archive.bundle,
        includeRetainedSources: true,
      });
      await verifySources(
        owner.actor,
        restored.retainedSources.filter((source) => source.kind === "file"),
        false
      );
      // Restoring retained history can advance the current lineage or rebuild a
      // lost projection. It cannot roll back a later correction/tombstone or
      // import a divergent history. Explicit reversal remains a separate write.
      if (
        current.head !== null &&
        !restored.operations.some((entry) => entry.revision === current.head)
      )
        throw new PrivateMemoryError("conflict");
      await verifySources(
        owner.actor,
        restored.snapshot.claims
          .map((claim) => claim.file)
          .flatMap((file) =>
            file.state.kind === "active" ? file.state.body.sources : []
          )
          .filter((source) => source.kind === "file"),
        true
      );
      await requireWorkspaceAccess(owner.actor);
      const identical =
        current.head === archive.revision &&
        (current.bundle === null
          ? archive.bundle === null
          : archive.bundle !== null &&
            Buffer.from(current.bundle).equals(Buffer.from(archive.bundle)));
      if (current.head !== archive.revision && current.head !== expected)
        throw new PrivateMemoryError("conflict");
      if (current.head === null && archive.revision !== null) {
        // A missing projection must not permit an older archive to bypass a later
        // tombstone. Retained operational high-water mark is a denial fence, not
        // the authority for facts. If both head and receipts are lost, recovery
        // requires the coordinated installation backup, never a blind overwrite.
        const latest = await query<{
          revision: string;
        }>(sql`SELECT revision FROM private_memory_operation
          WHERE namespace_id = ${owner.namespace.id} ORDER BY recorded_at DESC LIMIT 1`);
        if (latest[0]?.revision !== archive.revision)
          throw new PrivateMemoryError("conflict");
      }
      // Even an identical Git head may have lost immutable files/receipt indexes.
      // Full lineage/CAS/high-water/current file access is checked before writes.
      const citations = restored.retainedSources.filter(
        (source) => source.kind === "session"
      );
      if (archive.version === 3) {
        // Archive metadata never reconstructs or resets the retained capture fence.
        if (
          archive.sources.length > owner.namespace.journalEventCount ||
          (archive.capturedThrough !== null &&
            (owner.namespace.journalHighWater === null ||
              archive.capturedThrough > owner.namespace.journalHighWater))
        )
          throw new PrivateMemoryError("conflict");
        await restoreCompleteSessionSources(
          owner.actor,
          owner.namespace.id,
          citations,
          archive.sources
        );
      } else
        await restoreSessionClaimSources(
          owner.actor,
          owner.namespace.id,
          citations,
          archive.sources
        );
      if (identical) return { applied: false as const, revision: current.head };
      const written =
        await query(sql`UPDATE private_memory_repository SET head_sha = ${archive.revision},bundle = ${archive.bundle},
        recorded_at = ${restored.snapshot.recordedAt}::timestamptz
        WHERE namespace_id = ${owner.namespace.id} AND head_sha IS NOT DISTINCT FROM ${current.head} RETURNING namespace_id`);
      if (written.length !== 1) throw new PrivateMemoryError("conflict");
      await query(
        sql`DELETE FROM private_memory_operation WHERE namespace_id = ${owner.namespace.id}`
      );
      for (const entry of restored.operations.toReversed())
        await recordOperation(owner.namespace.id, entry);
      await query(
        sql`UPDATE workspace_memory_recall SET snapshot = NULL WHERE namespace_id = ${owner.namespace.id}`
      );
      return { applied: true as const, revision: archive.revision };
    },
    { outermost: true }
  );
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
    if (
      !actor.authSessionId ||
      actor.channelIdentityId ||
      actor.matrixIdentityId
    )
      throw new WorkspaceAccessDenied();
    const owner = await privateScope(actor);
    if (
      archive.namespaceId !== owner.namespace.id ||
      archive.scope.userId !== owner.scope.userId ||
      archive.scope.workspaceId !== owner.scope.workspaceId
    )
      throw new WorkspaceAccessDenied();
    requirePrivateMemoryArchiveAuthentication(archive);
    const current = await stored(owner.namespace.id, true);
    const restored = await readPrivateMemoryGit({
      scope: owner.scope,
      head: archive.revision,
      bundle: archive.bundle,
      includeRetainedSources: true,
    });
    if (
      current.head !== null &&
      !restored.operations.some((entry) => entry.revision === current.head)
    )
      throw new PrivateMemoryError("conflict");
    if (current.head === null && archive.revision !== null) {
      const [latest] =
        await query(sql`SELECT revision FROM private_memory_operation
        WHERE namespace_id=${owner.namespace.id} ORDER BY recorded_at DESC LIMIT 1`);
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
          claim.file.state.kind === "active"
            ? claim.file.state.body.sources
            : []
        )
        .filter((source) => source.kind === "file"),
      true
    );
    if (
      archive.version === 3 &&
      (archive.sources.length > owner.namespace.journalEventCount ||
        (archive.capturedThrough !== null &&
          (owner.namespace.journalHighWater === null ||
            archive.capturedThrough > owner.namespace.journalHighWater)))
    )
      throw new PrivateMemoryError("conflict");
    await inspectSessionSourceArchive(
      owner.actor,
      owner.namespace.id,
      restored.retainedSources.filter((source) => source.kind === "session"),
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
  change(
    actor: z.infer<typeof WorkspaceActorSchema>,
    raw: z.infer<typeof LearnedClaimChangeSchema>
  ) {
    return authorized(async () => {
      const change = LearnedClaimChangeSchema.parse(raw);
      const owner = await privateScope(actor);
      if (!owner.namespace.automaticEnabled && change.action === "assert")
        throw new PrivateMemoryError("disabled");
      const repository = await stored(owner.namespace.id);
      // Replay is resolved from canonical commit metadata before the CAS check.
      const result = await publishPrivateMemoryGit({
        scope: owner.scope,
        bundle: repository.bundle,
        head: repository.head,
        change,
        publication: async () => {
          const rows = await query<{ recordedAt: string }>(sql`SELECT to_char(
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
          applied: false as const,
          receipt: LearnedClaimReceiptSchema.parse(result.receipt),
        };
      await verifyEvidence(
        owner.actor,
        "claim" in result
          ? [result.claim.file]
          : result.cleared.map((claim) => claim.file),
        true
      );
      await requireWorkspaceAccess(owner.actor);
      const published = await query(sql`UPDATE private_memory_repository SET
        head_sha = ${result.receipt.revision}, bundle = ${result.bundle}, recorded_at = ${result.snapshot.recordedAt}::timestamptz
        WHERE namespace_id = ${owner.namespace.id} AND head_sha IS NOT DISTINCT FROM ${change.expectedRevision}
        RETURNING namespace_id`);
      if (published.length !== 1) throw new PrivateMemoryError("conflict");
      await recordOperation(owner.namespace.id, {
        revision: result.receipt.revision,
        operation: result.operation,
      });
      // Old recall receipts remain tombstoned instead of silently replaying new facts.
      await query(
        sql`UPDATE workspace_memory_recall SET snapshot = NULL WHERE namespace_id = ${owner.namespace.id}`
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
    });
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
      const erasure =
        await query(sql`SELECT namespace_id FROM workspace_memory_erasure
        WHERE namespace_id = ${owner.namespace.id}`);
      if (erasure.length) throw new PrivateMemoryError("conflict");
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

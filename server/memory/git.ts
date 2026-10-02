import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { z } from "zod";
import {
  LearnedClaimFileSchema,
  type LearnedClaimBodySchema,
  type LearnedClaimChangeSchema,
  LearnedClaimPublicationSchema,
  LearnedClaimOperationSchema,
  LearnedClaimReceiptSchema,
  LearnedClaimScopeSchema,
  LearnedClaimVersionSchema,
  learnedClaimLimits,
} from "../../packages/companion-ui/src/learned/claim";
import { GitRevisionSchema } from "../../packages/companion-ui/src/library/files-schema";
import { withGitBundle, GitBundleError, type GitBundle } from "../files/git";
import { mapAsync } from "../operations/async";
import {
  bindLearnedClaimPublication,
  planLearnedClaim,
  planLearnedClaimClear,
  bindLearnedClaimClear,
  validateLearnedClaimSnapshot,
  learnedClaimRequestHash,
} from "./claims";

/** Processing budgets fail closed; they never discard authoritative history. */
export const privateMemoryGitLimits = {
  fileBytes: learnedClaimLimits.fileBytes,
  bundleBytes: 25_165_824,
  outputBytes: learnedClaimLimits.snapshotBytes,
  operations: 10_000,
} as const;
const pathFor = (id: string) => `claims/${z.uuid().parse(id)}.json`;
const sameScope = (
  left: z.infer<typeof LearnedClaimScopeSchema>,
  right: z.infer<typeof LearnedClaimScopeSchema>
) => left.workspaceId === right.workspaceId && left.userId === right.userId;
const invalid = (): never => {
  throw new GitBundleError({ reason: "invalid_file" });
};

function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return invalid();
  }
}

async function verifyBundleHead(
  git: GitBundle["git"],
  directory: string,
  head: string
) {
  const refs = (
    await git(["bundle", "list-heads", `${directory}/source.bundle`])
  )
    .trim()
    .split("\n");
  if (
    !refs.includes(`${head} refs/heads/main`) ||
    refs.some(
      (ref) => ref !== `${head} refs/heads/main` && ref !== `${head} HEAD`
    )
  )
    invalid();
}

function includesClaim(
  operation: z.infer<typeof LearnedClaimOperationSchema>,
  id: string
) {
  return operation.claimId === null
    ? operation.clearedClaimIds.includes(id)
    : operation.claimId === id;
}

async function validateChanges(
  git: GitBundle["git"],
  scope: z.infer<typeof LearnedClaimScopeSchema>,
  entry: {
    revision: string;
    operation: z.infer<typeof LearnedClaimOperationSchema>;
  },
  changedPaths: readonly string[]
) {
  const { operation } = entry;
  const paths = changedPaths.toSorted();
  if (operation.claimId !== null) {
    if (JSON.stringify(paths) !== JSON.stringify([pathFor(operation.claimId)]))
      invalid();
    return;
  }
  const activeIds: string[] = [];
  if (operation.parentRevision) {
    const tree = await git([
      "ls-tree",
      "-r",
      "--name-only",
      operation.parentRevision,
    ]);
    const parentTree = tree.replace(/\n$/u, "");
    const parentPaths = parentTree ? parentTree.split("\n") : [];
    if (parentPaths.length > learnedClaimLimits.claims)
      throw new GitBundleError({ reason: "too_large" });
    for (const path of parentPaths) {
      const match = /^claims\/([a-f0-9-]{36})\.json$/u.exec(path);
      const claimId = match?.[1] ?? invalid();
      const file = LearnedClaimFileSchema.parse(
        parsedJson(await git(["show", `${operation.parentRevision}:${path}`]))
      );
      if (file.id !== claimId || !sameScope(file.scope, scope)) invalid();
      if (file.state.kind === "active") activeIds.push(file.id);
    }
  }
  activeIds.sort();
  if (
    JSON.stringify(activeIds) !== JSON.stringify(operation.clearedClaimIds) ||
    learnedClaimRequestHash(scope, {
      action: "clear",
      operationId: operation.operationId,
      expectedRevision: operation.parentRevision,
    }) !== operation.requestHash
  )
    invalid();

  if (
    JSON.stringify(paths) !== JSON.stringify(activeIds.map(pathFor).toSorted())
  )
    invalid();
}

async function readOperations(
  git: GitBundle["git"],
  scope: z.infer<typeof LearnedClaimScopeSchema>,
  revision: string
) {
  const output = await git([
    "log",
    `--max-count=${privateMemoryGitLimits.operations + 1}`,
    "--format=%H%x00%P%x00%B%x00",
    revision,
    "--",
  ]);
  const fields = output.split("\0");
  if (fields.pop()?.trim() || fields.length % 3 !== 0) invalid();
  if (fields.length / 3 > privateMemoryGitLimits.operations)
    throw new GitBundleError({ reason: "too_large" });
  const operations = [];
  const ids = new Set<string>();
  for (let index = 0; index < fields.length; index += 3) {
    const sha = GitRevisionSchema.parse(fields[index]?.trim());
    const parentField = fields[index + 1]?.trim() ?? "";
    const parent = parentField === "" ? null : parentField;
    const operation = LearnedClaimOperationSchema.parse(
      parsedJson(fields[index + 2] ?? "")
    );
    if (
      !sameScope(scope, operation.scope) ||
      operation.authorUserId !== scope.userId ||
      operation.parentRevision !== parent ||
      ids.has(operation.operationId)
    )
      invalid();
    ids.add(operation.operationId);
    operations.push({ revision: sha, operation });
  }
  for (const [index, entry] of operations.entries()) {
    const previous = operations[index + 1];
    if (
      entry.operation.parentRevision !== (previous?.revision ?? null) ||
      (previous && entry.operation.recordedAt <= previous.operation.recordedAt)
    )
      invalid();
  }
  if (operations[0]?.revision !== revision) invalid();
  // One native Git walk validates all changed paths. Reconstructing an entire
  // history must not launch another subprocess for every ordinary operation.
  const changes = (
    await git([
      "log",
      `--max-count=${privateMemoryGitLimits.operations + 1}`,
      "--format=%x00%H%x00",
      "--name-only",
      "--no-renames",
      "--root",
      revision,
      "--",
    ])
  ).split("\0");
  if (changes.shift()?.trim() || changes.length !== operations.length * 2)
    invalid();
  for (const [index, entry] of operations.entries()) {
    if (changes[index * 2]?.trim() !== entry.revision) invalid();
    const changed = (changes[index * 2 + 1] ?? "").replace(/^\n+|\n+$/gu, "");
    await validateChanges(
      git,
      scope,
      entry,
      changed ? changed.split("\n") : []
    );
  }
  return operations;
}

async function readVersion(
  git: GitBundle["git"],
  scope: z.infer<typeof LearnedClaimScopeSchema>,
  operations: Awaited<ReturnType<typeof readOperations>>,
  claimId: string,
  revision: string,
  expectedBlob?: string
) {
  const index = operations.findIndex(
    (item) =>
      item.revision === revision && includesClaim(item.operation, claimId)
  );
  const entry = operations[index] ?? invalid();
  const raw = await git(["show", `${revision}:${pathFor(claimId)}`]);
  if (
    expectedBlob &&
    createHash("sha1")
      .update(`blob ${Buffer.byteLength(raw)}\0`)
      .update(raw)
      .digest("hex") !== expectedBlob
  )
    invalid();
  const file = LearnedClaimFileSchema.parse(parsedJson(raw));
  const predecessor = operations
    .slice(index + 1)
    .find((item) => includesClaim(item.operation, claimId));
  if (
    file.id !== claimId ||
    !sameScope(scope, file.scope) ||
    file.predecessor !== (predecessor?.revision ?? null) ||
    (file.restoredFrom !== null &&
      !operations
        .slice(index + 1)
        .some(
          (item) =>
            item.revision === file.restoredFrom &&
            includesClaim(item.operation, claimId)
        ))
  )
    invalid();
  const change = {
    claimId: file.id,
    operationId: entry.operation.operationId,
    expectedRevision: entry.operation.parentRevision,
  };
  const mutation =
    entry.operation.claimId === null
      ? {
          action: "clear" as const,
          operationId: entry.operation.operationId,
          expectedRevision: entry.operation.parentRevision,
        }
      : file.restoredFrom !== null
        ? {
            ...change,
            action: "reverse" as const,
            targetRevision: file.restoredFrom,
          }
        : file.state.kind === "tombstone"
          ? { ...change, action: "tombstone" as const }
          : {
              ...change,
              action:
                file.predecessor === null
                  ? ("assert" as const)
                  : ("correct" as const),
              body: file.state.body,
            };
  if (
    entry.operation.claimId === null &&
    (file.state.kind !== "tombstone" || file.restoredFrom !== null)
  )
    invalid();
  if (learnedClaimRequestHash(scope, mutation) !== entry.operation.requestHash)
    invalid();
  if (Buffer.byteLength(JSON.stringify(file)) > learnedClaimLimits.fileBytes)
    throw new GitBundleError({ reason: "too_large" });
  return LearnedClaimVersionSchema.parse({
    file,
    revision,
    recordedAt: entry.operation.recordedAt,
    authorUserId: entry.operation.authorUserId,
    operationId: entry.operation.operationId,
  });
}

async function capture(
  git: GitBundle["git"],
  scope: z.infer<typeof LearnedClaimScopeSchema>,
  head: string | null,
  revision: string | null = head,
  recordedThrough?: string
) {
  if (head === null)
    return {
      snapshot: validateLearnedClaimSnapshot(scope, {
        scope,
        revision: null,
        recordedAt: null,
        claims: [],
      }),
      operations: [],
    };
  const operations = await readOperations(
    git,
    scope,
    GitRevisionSchema.parse(head)
  );
  // A clear receipt must describe tombstones, even after a later reversal
  // replaces them. Its historical blobs remain inside a recovery bundle.
  for (const entry of operations)
    if (entry.operation.claimId === null)
      await mapAsync(
        entry.operation.clearedClaimIds,
        (id) => readVersion(git, scope, operations, id, entry.revision),
        4
      );
  if (recordedThrough !== undefined) {
    const cutoff =
      LearnedClaimPublicationSchema.shape.recordedAt.parse(recordedThrough);
    revision =
      operations.find((item) => item.operation.recordedAt <= cutoff)
        ?.revision ?? null;
  }
  if (!revision)
    return {
      snapshot: validateLearnedClaimSnapshot(scope, {
        scope,
        revision: null,
        recordedAt: null,
        claims: [],
      }),
      operations,
    };
  const selected = operations.findIndex((item) => item.revision === revision);
  if (selected < 0) invalid();
  const history = operations.slice(selected);
  const tree = await git(["ls-tree", "-r", "-z", revision]);
  const files = tree
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match =
        /^100644 blob ([a-f0-9]{40})\tclaims\/([a-f0-9-]{36})\.json$/u.exec(
          entry
        );
      if (!match?.[1] || !match[2]) return invalid();
      return { id: z.uuid().parse(match[2]), blob: match[1] };
    });
  if (files.length > learnedClaimLimits.claims)
    throw new GitBundleError({ reason: "too_large" });
  const heads = new Map<string, string>();
  for (const item of history)
    for (const id of item.operation.claimId === null
      ? item.operation.clearedClaimIds
      : [item.operation.claimId])
      if (!heads.has(id)) heads.set(id, item.revision);
  if (files.length !== heads.size || files.some(({ id }) => !heads.has(id)))
    invalid();
  const claims = await mapAsync(
    files,
    ({ id, blob }) =>
      readVersion(git, scope, history, id, heads.get(id) ?? invalid(), blob),
    4
  );
  return {
    snapshot: validateLearnedClaimSnapshot(scope, {
      scope,
      revision,
      recordedAt: history[0]?.operation.recordedAt ?? null,
      claims,
    }),
    operations,
  };
}

/** Caller must capture bundle/head under current private authorization. Git history
 * proves scope and lineage, not current membership or source permission. */
export async function readPrivateMemoryGit(input: {
  scope: z.infer<typeof LearnedClaimScopeSchema>;
  bundle: Uint8Array | null;
  head: string | null;
  revision?: string | null;
  recordedThrough?: string;
  historyClaimId?: string;
  includeRetainedSources?: boolean;
}) {
  const scope = LearnedClaimScopeSchema.parse(input.scope);
  if ((input.bundle === null) !== (input.head === null)) invalid();
  return withGitBundle(
    { bundle: input.bundle, limits: privateMemoryGitLimits },
    async ({ directory, git }) => {
      if (input.head) await verifyBundleHead(git, directory, input.head);
      const captured = await capture(
        git,
        scope,
        input.head,
        input.revision === undefined ? input.head : input.revision,
        input.recordedThrough
      );
      let historyBytes = 2;
      let historyEntries = 0;
      const history =
        input.historyClaimId === undefined
          ? []
          : await mapAsync(
              captured.operations.filter((item) =>
                includesClaim(item.operation, input.historyClaimId ?? invalid())
              ),
              async (item) => {
                const version = await readVersion(
                  git,
                  scope,
                  captured.operations,
                  input.historyClaimId ?? invalid(),
                  item.revision
                );
                // Bound the complete UTF-8 response before retaining each version.
                // A partial prefix must never masquerade as authoritative history.
                historyBytes +=
                  Buffer.byteLength(JSON.stringify(version)) +
                  (historyEntries++ ? 1 : 0);
                if (historyBytes > privateMemoryGitLimits.outputBytes)
                  throw new GitBundleError({ reason: "too_large" });
                return version;
              },
              4
            );
      // A recovery archive retains evidence from every historical active version,
      // including later corrections and clears. The caller must reauthorize
      // all of these sources; response bounds never establish retention policy.
      const retainedSources: z.infer<typeof LearnedClaimBodySchema>["sources"] =
        [];
      if (input.includeRetainedSources) {
        const seen = new Set<string>();
        let bytes = 2;
        for (const entry of captured.operations) {
          // Clear contains only tombstones. Its predecessors own the evidence.
          if (entry.operation.claimId === null) continue;
          const version = await readVersion(
            git,
            scope,
            captured.operations,
            entry.operation.claimId,
            entry.revision
          );
          if (version.file.state.kind !== "active") continue;
          for (const source of version.file.state.body.sources) {
            const encoded = JSON.stringify(source);
            if (seen.has(encoded)) continue;
            bytes += Buffer.byteLength(encoded) + (seen.size ? 1 : 0);
            if (bytes > privateMemoryGitLimits.outputBytes)
              throw new GitBundleError({ reason: "too_large" });
            seen.add(encoded);
            retainedSources.push(source);
          }
        }
      }
      return { ...captured, history, retainedSources };
    }
  );
}

/** Native Git creates the actual SHA after the pure mutation plan. Authoritative
 * operation metadata is the immutable commit message, never a SQL-only receipt. */
export async function publishPrivateMemoryGit(input: {
  scope: z.infer<typeof LearnedClaimScopeSchema>;
  bundle: Uint8Array | null;
  head: string | null;
  change: z.infer<typeof LearnedClaimChangeSchema>;
  publication: () => Promise<
    Parameters<typeof planLearnedClaim>[0]["publication"]
  >;
}) {
  const scope = LearnedClaimScopeSchema.parse(input.scope);
  if ((input.bundle === null) !== (input.head === null)) invalid();
  return withGitBundle(
    { bundle: input.bundle, limits: privateMemoryGitLimits },
    async ({ directory, git }) => {
      if (input.head) await verifyBundleHead(git, directory, input.head);
      const current = await capture(git, scope, input.head);
      const previous = current.operations.find(
        (item) => item.operation.operationId === input.change.operationId
      );
      const previousReceipt = previous
        ? LearnedClaimReceiptSchema.parse({
            scope,
            claimId: previous.operation.claimId,
            operationId: previous.operation.operationId,
            requestHash: previous.operation.requestHash,
            revision: previous.revision,
          })
        : undefined;
      const reversalTarget =
        !previous && input.change.action === "reverse"
          ? await readVersion(
              git,
              scope,
              current.operations,
              input.change.claimId,
              input.change.targetRevision
            )
          : undefined;
      const publication = await input.publication();
      const plan =
        input.change.action === "clear"
          ? planLearnedClaimClear({
              scope,
              current: current.snapshot,
              change: input.change,
              publication,
              previousReceipt,
            })
          : planLearnedClaim({
              scope,
              current: current.snapshot,
              change: input.change,
              publication,
              previousReceipt,
              reversalTarget,
            });
      if (!plan.applied) return plan;
      if (input.head) await git(["read-tree", input.head]);
      for (const claim of "files" in plan ? plan.files : [plan.file]) {
        const file = `${directory}/claim.json`;
        await fs.writeFile(file, JSON.stringify(claim) + "\n", { mode: 0o600 });
        const blob = (await git(["hash-object", "-w", "--", file])).trim();
        await git([
          "update-index",
          "--add",
          "--cacheinfo",
          `100644,${blob},${pathFor(claim.id)}`,
        ]);
      }
      const tree = (await git(["write-tree"])).trim();
      const revision = (
        await git([
          "commit-tree",
          tree,
          ...(input.head ? ["-p", input.head] : []),
          "-m",
          JSON.stringify(plan.operation),
        ])
      ).trim();
      const result =
        "files" in plan
          ? bindLearnedClaimClear({ plan, current: current.snapshot, revision })
          : bindLearnedClaimPublication({
              plan,
              current: current.snapshot,
              revision,
            });
      await git(["update-ref", "refs/heads/main", revision]);
      const destination = `${directory}/published.bundle`;
      await git(["bundle", "create", destination, "--all"]);
      if (
        (await fs.stat(destination)).size > privateMemoryGitLimits.bundleBytes
      )
        throw new GitBundleError({ reason: "too_large" });
      return {
        applied: true as const,
        ...result,
        bundle: Buffer.from(await fs.readFile(destination)),
        operation: plan.operation,
      };
    }
  );
}

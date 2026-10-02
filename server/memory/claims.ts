import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  LearnedClaimChangeSchema,
  LearnedClaimPublicationSchema,
  LearnedClaimOperationSchema,
  LearnedClaimFileSchema,
  LearnedClaimReceiptSchema,
  LearnedClaimScopeSchema,
  LearnedClaimSnapshotSchema,
  LearnedClaimVersionSchema,
  learnedClaimLimits,
} from "../../packages/companion-ui/src/learned/claim";

export class LearnedClaimError extends Error {
  readonly _tag = "LearnedClaimError";
  constructor(
    readonly reason: "conflict" | "invalid_input",
    message: string
  ) {
    super(message);
    this.name = "LearnedClaimError";
  }
}

/** Canonical request identity shared by planning and immutable receipt checks. */
export function learnedClaimRequestHash(
  scope: z.infer<typeof LearnedClaimScopeSchema>,
  change: z.infer<typeof LearnedClaimChangeSchema>
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        scope: LearnedClaimScopeSchema.parse(scope),
        change: LearnedClaimChangeSchema.parse(change),
      })
    )
    .digest("hex");
}

/** Pure checks only: the caller must hold current authorization and supply an
 * authoritative snapshot. No schema, projection, or caller-supplied scope grants access. */
export function validateLearnedClaimSnapshot(
  scope: z.infer<typeof LearnedClaimScopeSchema>,
  value: z.infer<typeof LearnedClaimSnapshotSchema>
) {
  const expected = LearnedClaimScopeSchema.parse(scope);
  const snapshot = LearnedClaimSnapshotSchema.parse(value);
  if (
    snapshot.scope.userId !== expected.userId ||
    snapshot.scope.workspaceId !== expected.workspaceId
  )
    throw new LearnedClaimError("invalid_input", "Claim scope mismatch");
  if (
    Buffer.byteLength(JSON.stringify(snapshot)) >
    learnedClaimLimits.snapshotBytes
  )
    throw new LearnedClaimError(
      "invalid_input",
      "Claim snapshot exceeds its byte limit"
    );
  for (const claim of snapshot.claims) {
    if (
      Buffer.byteLength(JSON.stringify(claim.file)) >
      learnedClaimLimits.fileBytes
    )
      throw new LearnedClaimError(
        "invalid_input",
        "Claim file exceeds its byte limit"
      );
  }
  return snapshot;
}

/** Plans one mutation without a future SHA or persistence. The repository must
 * commit the file and operation metadata, bind the actual revision, then CAS.
 * Current authorization and source verification belong to that publisher.
 * previousReceipt and reversalTarget must come from that same authorized owner. */
export function planLearnedClaim(input: {
  scope: z.infer<typeof LearnedClaimScopeSchema>;
  current: z.infer<typeof LearnedClaimSnapshotSchema>;
  change: Exclude<
    z.infer<typeof LearnedClaimChangeSchema>,
    { action: "clear" }
  >;
  publication: Pick<
    z.infer<typeof LearnedClaimPublicationSchema>,
    "recordedAt" | "authorUserId"
  >;
  previousReceipt?: z.infer<typeof LearnedClaimReceiptSchema>;
  reversalTarget?: z.infer<typeof LearnedClaimVersionSchema>;
}) {
  const current = validateLearnedClaimSnapshot(input.scope, input.current);
  const change = LearnedClaimChangeSchema.parse(input.change);
  if (change.action === "clear")
    throw new LearnedClaimError(
      "invalid_input",
      "Use the complete snapshot clear plan"
    );
  const publication = LearnedClaimPublicationSchema.omit({
    revision: true,
  }).parse(input.publication);
  if (publication.authorUserId !== current.scope.userId)
    throw new LearnedClaimError(
      "invalid_input",
      "Claim author does not own this private scope"
    );
  const requestHash = learnedClaimRequestHash(current.scope, change);
  if (input.previousReceipt) {
    const receipt = LearnedClaimReceiptSchema.parse(input.previousReceipt);
    if (
      receipt.scope.userId !== current.scope.userId ||
      receipt.scope.workspaceId !== current.scope.workspaceId ||
      receipt.claimId !== change.claimId ||
      receipt.operationId !== change.operationId ||
      receipt.requestHash !== requestHash
    )
      throw new LearnedClaimError(
        "conflict",
        "Claim operation conflicts with its receipt"
      );
    // Replay returns no file to apply: an old successful assertion cannot
    // overwrite a later correction or resurrect a later tombstone.
    return { applied: false as const, receipt };
  }
  if (current.revision !== change.expectedRevision)
    throw new LearnedClaimError("conflict", "Claim revision conflict");
  if (
    current.recordedAt !== null &&
    publication.recordedAt <= current.recordedAt
  )
    throw new LearnedClaimError(
      "invalid_input",
      "Claim publication must advance recorded history"
    );
  const existing = current.claims.find(
    (claim) => claim.file.id === change.claimId
  );
  let state: z.infer<typeof LearnedClaimVersionSchema>["file"]["state"];
  let restoredFrom: string | null = null;
  switch (change.action) {
    case "assert":
      if (existing)
        throw new LearnedClaimError(
          "conflict",
          "Claim identity already exists"
        );
      if (current.claims.length >= learnedClaimLimits.claims)
        throw new LearnedClaimError(
          "invalid_input",
          "Claim capacity exceeded; history cannot be silently discarded"
        );
      state = { kind: "active", body: change.body };
      break;
    case "correct":
      if (existing?.file.state.kind !== "active")
        throw new LearnedClaimError(
          "invalid_input",
          "Only an active claim can be corrected"
        );
      state = { kind: "active", body: change.body };
      break;
    case "tombstone":
      if (existing?.file.state.kind !== "active")
        throw new LearnedClaimError(
          "invalid_input",
          "Only an active claim can be tombstoned"
        );
      state = { kind: "tombstone" };
      break;
    case "reverse": {
      if (!existing || !input.reversalTarget)
        throw new LearnedClaimError(
          "invalid_input",
          "Claim reversal requires an authorized historical target"
        );
      const target = LearnedClaimVersionSchema.parse(input.reversalTarget);
      if (
        target.file.id !== change.claimId ||
        target.file.scope.userId !== current.scope.userId ||
        target.file.scope.workspaceId !== current.scope.workspaceId ||
        target.authorUserId !== current.scope.userId ||
        target.revision !== change.targetRevision ||
        target.recordedAt >= existing.recordedAt
      )
        throw new LearnedClaimError(
          "invalid_input",
          "Invalid claim reversal target"
        );
      // The caller must verify that this target is a recorded ancestor, not
      // merely a correctly shaped value. Reversal is an explicit new write.
      state = target.file.state;
      restoredFrom = target.revision;
      break;
    }
  }
  if (state.kind === "active") {
    const previousRelations =
      existing?.file.state.kind === "active"
        ? existing.file.state.body.relations
        : [];
    for (const relation of state.body.relations) {
      const destination = current.claims.find(
        (claim) => claim.file.id === relation.claimId
      );
      const retained =
        change.action === "correct" &&
        previousRelations.some(
          (previous) =>
            previous.kind === relation.kind &&
            previous.claimId === relation.claimId
        );
      // A correction may retain a known dangling link after its target was
      // tombstoned. Adding a link cannot grant access or reactivate that target.
      if (
        relation.claimId === change.claimId ||
        !destination ||
        (destination.file.state.kind !== "active" && !retained)
      )
        throw new LearnedClaimError(
          "invalid_input",
          "Claim relationship requires an active scoped target or a retained link"
        );
    }
  }
  const file = LearnedClaimFileSchema.parse({
    version: 1,
    id: change.claimId,
    scope: current.scope,
    predecessor: existing?.revision ?? null,
    restoredFrom,
    state,
  });
  if (Buffer.byteLength(JSON.stringify(file)) > learnedClaimLimits.fileBytes)
    throw new LearnedClaimError(
      "invalid_input",
      "Claim file exceeds its byte limit"
    );
  return {
    applied: true as const,
    file,
    operation: LearnedClaimOperationSchema.parse({
      ...publication,
      version: 1,
      scope: current.scope,
      parentRevision: current.revision,
      claimId: change.claimId,
      operationId: change.operationId,
      requestHash,
    }),
  };
}

/** Bind only after the publisher has created an actual immutable Git commit.
 * Validate the resulting complete snapshot before its transactional CAS write. */
export function bindLearnedClaimPublication(input: {
  plan: Extract<ReturnType<typeof planLearnedClaim>, { applied: true }>;
  current: z.infer<typeof LearnedClaimSnapshotSchema>;
  revision: string;
}) {
  const operation = LearnedClaimOperationSchema.parse(input.plan.operation);
  if (operation.claimId === null)
    throw new LearnedClaimError("invalid_input", "Invalid single claim plan");
  const file = LearnedClaimFileSchema.parse(input.plan.file);
  const current = validateLearnedClaimSnapshot(operation.scope, input.current);
  const publication = LearnedClaimPublicationSchema.parse({
    recordedAt: operation.recordedAt,
    authorUserId: operation.authorUserId,
    revision: input.revision,
  });
  if (
    file.id !== operation.claimId ||
    file.scope.workspaceId !== operation.scope.workspaceId ||
    file.scope.userId !== operation.scope.userId ||
    operation.authorUserId !== operation.scope.userId ||
    operation.parentRevision !== current.revision ||
    input.revision === current.revision ||
    (current.recordedAt !== null &&
      publication.recordedAt <= current.recordedAt)
  )
    throw new LearnedClaimError(
      "invalid_input",
      "Claim publication conflicts with its mutation plan"
    );
  const claim = LearnedClaimVersionSchema.parse({
    ...publication,
    operationId: operation.operationId,
    file,
  });
  const snapshot = validateLearnedClaimSnapshot(operation.scope, {
    scope: operation.scope,
    revision: publication.revision,
    recordedAt: publication.recordedAt,
    claims: [
      ...current.claims.filter((item) => item.file.id !== file.id),
      claim,
    ],
  });
  return {
    claim,
    snapshot,
    receipt: LearnedClaimReceiptSchema.parse({
      scope: operation.scope,
      claimId: operation.claimId,
      operationId: operation.operationId,
      requestHash: operation.requestHash,
      revision: publication.revision,
    }),
  };
}

/** A restore preflight, not restore authorization or permanent erasure. Current
 * tombstones must survive an older backup. Receipts, revoked sources and account
 * erasure fences still require the repository's atomic restore boundary. */
export function assertClaimRestorePreservesTombstones(input: {
  scope: z.infer<typeof LearnedClaimScopeSchema>;
  current: z.infer<typeof LearnedClaimSnapshotSchema>;
  restored: z.infer<typeof LearnedClaimSnapshotSchema>;
}) {
  const current = validateLearnedClaimSnapshot(input.scope, input.current);
  const restored = validateLearnedClaimSnapshot(input.scope, input.restored);
  for (const claim of current.claims) {
    if (claim.file.state.kind !== "tombstone") continue;
    const replacement = restored.claims.find(
      (item) => item.file.id === claim.file.id
    );
    if (!replacement || JSON.stringify(replacement) !== JSON.stringify(claim))
      throw new LearnedClaimError(
        "invalid_input",
        "Restore must preserve the current claim tombstone"
      );
  }
}

/** One clear commit retains every file as a tombstone. No per-note commits,
 * partial clearing, deletion of history, or operation-key reuse across notes. */
export function planLearnedClaimClear(input: {
  scope: z.infer<typeof LearnedClaimScopeSchema>;
  current: z.infer<typeof LearnedClaimSnapshotSchema>;
  change: Extract<
    z.infer<typeof LearnedClaimChangeSchema>,
    { action: "clear" }
  >;
  publication: Pick<
    z.infer<typeof LearnedClaimPublicationSchema>,
    "recordedAt" | "authorUserId"
  >;
  previousReceipt?: z.infer<typeof LearnedClaimReceiptSchema>;
}) {
  const current = validateLearnedClaimSnapshot(input.scope, input.current);
  const change = LearnedClaimChangeSchema.parse(input.change);
  if (change.action !== "clear")
    throw new LearnedClaimError("invalid_input", "Invalid clear action");
  const requestHash = learnedClaimRequestHash(current.scope, change);
  if (input.previousReceipt) {
    const receipt = LearnedClaimReceiptSchema.parse(input.previousReceipt);
    if (
      receipt.claimId !== null ||
      receipt.operationId !== change.operationId ||
      receipt.requestHash !== requestHash ||
      receipt.scope.userId !== current.scope.userId ||
      receipt.scope.workspaceId !== current.scope.workspaceId
    )
      throw new LearnedClaimError(
        "conflict",
        "Clear operation conflicts with its receipt"
      );
    return { applied: false as const, receipt };
  }
  const publication = LearnedClaimPublicationSchema.omit({
    revision: true,
  }).parse(input.publication);
  if (current.revision !== change.expectedRevision)
    throw new LearnedClaimError("conflict", "Claim revision conflict");
  if (
    publication.authorUserId !== current.scope.userId ||
    (current.recordedAt !== null &&
      publication.recordedAt <= current.recordedAt)
  )
    throw new LearnedClaimError(
      "invalid_input",
      "Invalid clear publication authority or time"
    );
  const files = current.claims
    .filter((claim) => claim.file.state.kind === "active")
    .toSorted((left, right) =>
      left.file.id < right.file.id ? -1 : left.file.id > right.file.id ? 1 : 0
    )
    .map((claim) =>
      LearnedClaimFileSchema.parse({
        ...claim.file,
        predecessor: claim.revision,
        restoredFrom: null,
        state: { kind: "tombstone" },
      })
    );
  const operation = LearnedClaimOperationSchema.parse({
    ...publication,
    version: 1,
    scope: current.scope,
    parentRevision: current.revision,
    claimId: null,
    clearedClaimIds: files.map((file) => file.id),
    operationId: change.operationId,
    requestHash,
  });
  if (operation.claimId !== null)
    throw new LearnedClaimError("invalid_input", "Invalid clear metadata");
  return { applied: true as const, files, operation };
}

export function bindLearnedClaimClear(input: {
  plan: Extract<ReturnType<typeof planLearnedClaimClear>, { applied: true }>;
  current: z.infer<typeof LearnedClaimSnapshotSchema>;
  revision: string;
}) {
  const current = validateLearnedClaimSnapshot(
    input.plan.operation.scope,
    input.current
  );
  const plan = planLearnedClaimClear({
    scope: current.scope,
    current,
    change: {
      action: "clear",
      operationId: input.plan.operation.operationId,
      expectedRevision: input.plan.operation.parentRevision,
    },
    publication: {
      recordedAt: input.plan.operation.recordedAt,
      authorUserId: input.plan.operation.authorUserId,
    },
  });
  if (!plan.applied || JSON.stringify(plan) !== JSON.stringify(input.plan))
    throw new LearnedClaimError(
      "invalid_input",
      "Clear publication differs from its complete snapshot plan"
    );
  const publication = LearnedClaimPublicationSchema.parse({
    recordedAt: plan.operation.recordedAt,
    authorUserId: plan.operation.authorUserId,
    revision: input.revision,
  });
  if (publication.revision === current.revision)
    throw new LearnedClaimError(
      "invalid_input",
      "Clear must create a publication"
    );
  const cleared = plan.files.map((file) =>
    LearnedClaimVersionSchema.parse({
      ...publication,
      operationId: plan.operation.operationId,
      file,
    })
  );
  const changes = new Map(cleared.map((claim) => [claim.file.id, claim]));
  const snapshot = validateLearnedClaimSnapshot(current.scope, {
    scope: current.scope,
    revision: publication.revision,
    recordedAt: publication.recordedAt,
    claims: current.claims.map((claim) => changes.get(claim.file.id) ?? claim),
  });
  return {
    cleared,
    snapshot,
    receipt: LearnedClaimReceiptSchema.parse({
      scope: current.scope,
      claimId: null,
      operationId: plan.operation.operationId,
      requestHash: plan.operation.requestHash,
      revision: publication.revision,
    }),
  };
}

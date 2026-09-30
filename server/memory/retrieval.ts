import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type {
  LearnedClaimScopeSchema,
  LearnedClaimSnapshotSchema,
} from "../../packages/companion-ui/src/learned/claim";
import { learnedClaimLimits } from "../../packages/companion-ui/src/learned/claim";
import { LearnedClaimError, validateLearnedClaimSnapshot } from "./claims";

function terms(text: string) {
  return [
    ...new Set(
      text
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ),
  ];
}
const compare = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

/** Derived, bounded in-memory output only. No cache, storage, embeddings or
 * authorization is created. Tombstones remain in the source fingerprint. */
export function projectLearnedClaims(
  scope: z.infer<typeof LearnedClaimScopeSchema>,
  value: z.infer<typeof LearnedClaimSnapshotSchema>
) {
  const snapshot = validateLearnedClaimSnapshot(scope, value);
  const claims = snapshot.claims.toSorted((left, right) =>
    compare(left.file.id, right.file.id)
  );
  return {
    version: 1 as const,
    scope: snapshot.scope,
    revision: snapshot.revision,
    sourceDigest: createHash("sha256")
      .update(JSON.stringify({ ...snapshot, claims }))
      .digest("hex"),
    entries: claims.flatMap((claim) =>
      claim.file.state.kind === "active"
        ? [
            {
              id: claim.file.id,
              terms: terms(claim.file.state.body.text).toSorted(compare),
            },
          ]
        : []
    ),
  };
}

/** `current` must be captured under current authorization by the repository.
 * Validate the complete small projection before ranking; this groundwork favors
 * reproducibility over an unqualified persistent-index performance claim. */
export function searchLearnedClaims(input: {
  scope: z.infer<typeof LearnedClaimScopeSchema>;
  current: z.infer<typeof LearnedClaimSnapshotSchema>;
  projection: ReturnType<typeof projectLearnedClaims>;
  query: string;
  validOn?: string;
  limit?: number;
}) {
  const query = z
    .string()
    .max(learnedClaimLimits.queryCharacters)
    .parse(input.query);
  const limit = z
    .int()
    .min(1)
    .max(learnedClaimLimits.resultCount)
    .parse(input.limit ?? learnedClaimLimits.resultCount);
  const validOn =
    input.validOn === undefined ? undefined : z.iso.date().parse(input.validOn);
  const current = validateLearnedClaimSnapshot(input.scope, input.current);
  const expected = projectLearnedClaims(input.scope, current);
  if (!isDeepStrictEqual(input.projection, expected))
    throw new LearnedClaimError(
      "invalid_input",
      "Claim projection is stale, foreign, or inconsistent"
    );
  const queryTerms = terms(query);
  if (queryTerms.length > learnedClaimLimits.queryTerms)
    throw new LearnedClaimError(
      "invalid_input",
      "Claim query exceeds its term limit"
    );
  const matches =
    queryTerms.length === 0
      ? []
      : expected.entries
          .flatMap((entry) => {
            const claim = current.claims.find(
              (item) => item.file.id === entry.id
            );
            if (claim?.file.state.kind !== "active")
              throw new LearnedClaimError(
                "invalid_input",
                "Claim source is unavailable"
              );
            const interval = claim.file.state.body.validTime;
            if (
              validOn &&
              interval &&
              ((interval.from !== null && validOn < interval.from) ||
                (interval.until !== null && validOn >= interval.until))
            )
              return [];
            const score = queryTerms.filter((term) =>
              entry.terms.includes(term)
            ).length;
            return score === 0
              ? []
              : [
                  {
                    claim,
                    score,
                    validity:
                      interval === null
                        ? ("unknown" as const)
                        : validOn
                          ? ("in-range" as const)
                          : ("not-filtered" as const),
                  },
                ];
          })
          .toSorted(
            (left, right) =>
              right.score - left.score ||
              compare(left.claim.file.id, right.claim.file.id)
          );
  const result = {
    revision: current.revision,
    matches: matches.slice(0, limit),
    hasMore: matches.length > limit,
  };
  if (
    Buffer.byteLength(JSON.stringify(result)) > learnedClaimLimits.resultBytes
  )
    throw new LearnedClaimError(
      "invalid_input",
      "Claim results exceed their byte limit; narrow the query or limit"
    );
  return result;
}

/** An explicit audit read of an already authorized recorded snapshot. A later
 * correction or tombstone does not rewrite that historical evidence. Permanent
 * erasure/revocation can deny the snapshot before it reaches this pure function. */
export function readLearnedClaimAudit(input: {
  scope: z.infer<typeof LearnedClaimScopeSchema>;
  recorded: z.infer<typeof LearnedClaimSnapshotSchema>;
  claimId: string;
}) {
  const recorded = validateLearnedClaimSnapshot(input.scope, input.recorded);
  const id = z.uuid().parse(input.claimId);
  return {
    revision: recorded.revision,
    recordedAt: recorded.recordedAt,
    claim: recorded.claims.find((item) => item.file.id === id) ?? null,
  };
}

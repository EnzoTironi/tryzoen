import {
  planLearnedClaim,
  bindLearnedClaimPublication,
} from "../../server/memory/claims";
import type { z } from "zod";
import type { LearnedClaimPublicationSchema } from "../../packages/companion-ui/src/learned/claim";

/** Pure fixtures supply a known synthetic revision after planning, as the real
 * repository will supply its newly created commit. No production shim exists. */
export function publishClaimFixture(
  input: Omit<Parameters<typeof planLearnedClaim>[0], "publication"> & {
    publication: z.infer<typeof LearnedClaimPublicationSchema>;
  }
) {
  const { revision, ...publication } = input.publication;
  const plan = planLearnedClaim({ ...input, publication });
  return plan.applied
    ? {
        applied: true as const,
        ...bindLearnedClaimPublication({
          plan,
          current: input.current,
          revision,
        }),
      }
    : plan;
}

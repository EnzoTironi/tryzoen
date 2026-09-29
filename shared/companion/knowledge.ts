import type { KnowledgeProposalData } from "@zoen/companion-ui";
import {
  knowledgeProposalListSchema,
  knowledgeProposalReviewSchema,
} from "@zoen/companion-ui/knowledge";
import { GitRevisionSchema } from "@zoen/companion-ui/workspace-files";
import { z } from "zod";

export function companionKnowledgeData(
  rpc: {
    query: (path: string, input?: unknown) => Promise<unknown>;
    mutation: (path: string, input?: unknown) => Promise<unknown>;
  },
  scope: string,
  operationId: () => string,
  onReviewed: () => void
): KnowledgeProposalData {
  return {
    cacheKey: ["knowledge-proposals", scope],
    operationId,
    async list() {
      return knowledgeProposalListSchema.parse(
        await rpc.query("workspaces.knowledge.proposals")
      );
    },
    async read(path) {
      return knowledgeProposalReviewSchema.parse(
        await rpc.query("workspaces.knowledge.proposal", { path })
      );
    },
    async review(input) {
      const result = z
        .object({ revision: GitRevisionSchema })
        .parse(await rpc.mutation("workspaces.knowledge.review", input));
      onReviewed();
      return result;
    },
  };
}

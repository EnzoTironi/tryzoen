import type { KnowledgeProposalData, OntologyData } from "@zoen/companion-ui";
import { OntologyReadResultSchema } from "@zoen/companion-ui/ontology";
import { companionDocumentHistory } from "./files";
import {
  knowledgeProposalListSchema,
  knowledgeProposalReviewSchema,
} from "@zoen/companion-ui/knowledge";
import { GitRevisionSchema } from "@zoen/companion-ui/workspace-files";
import { z } from "zod";

export function companionOntologyData(
  rpc: Parameters<typeof companionKnowledgeData>[0],
  scope: string
): OntologyData {
  return {
    cacheKey: ["ontology", scope],
    async read(input) {
      return OntologyReadResultSchema.parse(
        await rpc.query("workspaces.ontology.read", input)
      );
    },
    async source(citation) {
      return companionDocumentHistory(rpc, citation.path, scope).read(
        citation.revision
      );
    },
  };
}

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

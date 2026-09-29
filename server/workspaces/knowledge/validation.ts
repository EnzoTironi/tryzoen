import { knowledgeProposalSchema } from "@zoen/companion-ui/knowledge";
import { OntologySchema, ontologyPath } from "@zoen/companion-ui/ontology";
import type { z } from "zod";
import { jsonString } from "@shared/validation";
import {
  OntologyInvalid,
  ontologyCitations,
  validateOntology,
} from "../ontology-validation";

/** The draft's graph and its cited files belong to the same reviewed change. */
export async function validateKnowledgeProposal(
  raw: z.output<typeof knowledgeProposalSchema>
) {
  const proposal = knowledgeProposalSchema.parse(raw);
  const ontology = proposal.changes.find(
    (change) => change.path === ontologyPath
  );
  const graph = ontology
    ? await validateOntology(jsonString(OntologySchema).parse(ontology.content))
    : null;
  const citations = [
    ...proposal.evidence.filter((item) => item.kind === "file"),
    ...(graph ? ontologyCitations(graph) : []),
  ];
  const paths = [
    ...new Set([
      ...proposal.changes.map((change) => change.path),
      ...proposal.dependencies,
      ...citations.map((source) => source.path),
    ]),
  ];
  if (
    paths.length > 24 ||
    new Set(citations.map((source) => `${source.revision}:${source.path}`))
      .size > 24
  )
    throw new OntologyInvalid({ reason: "source" });
  return { proposal, paths, citations };
}

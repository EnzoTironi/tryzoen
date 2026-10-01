import { knowledgeProposalSchema } from "@zoen/companion-ui/knowledge";
import { OntologySchema, ontologyPath } from "@zoen/companion-ui/ontology";
import type { z } from "zod";
import { sourceBindingPathSchema } from "@zoen/companion-ui/workspace-files";
import { sourceBindingSchema } from "@zoen/companion-ui/workspace-sources";
import type { readWorkspaceGitSelection } from "../git";
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
  for (const change of proposal.changes) {
    if (change.path.startsWith("knowledge/sources/") && change.content !== null)
      jsonString(sourceBindingSchema).parse(change.content);
  }
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

export const knowledgeSourceValidationLimits = {
  bindings: 16,
  bytes: 262_144,
} as const;

/** Complete candidate files, never inferred grants or a partial binding index. */
export async function validateKnowledgeSources(
  documents: Awaited<ReturnType<typeof readWorkspaceGitSelection>>
) {
  const sources = documents.filter(({ path }) =>
    path.startsWith("knowledge/sources/")
  );
  if (!sources.length) return;
  if (
    sources.length > knowledgeSourceValidationLimits.bindings ||
    new Set(documents.map(({ path }) => path)).size !== documents.length ||
    documents.reduce(
      (bytes, { content }) => bytes + Buffer.byteLength(content, "utf8"),
      0
    ) > knowledgeSourceValidationLimits.bytes
  )
    throw new OntologyInvalid({ reason: "source" });
  const ontology = documents.find(({ path }) => path === ontologyPath);
  if (!ontology) throw new OntologyInvalid({ reason: "type" });
  const graph = await validateOntology(
    jsonString(OntologySchema).parse(ontology.content)
  );
  const bindings = sources.map(({ path, content }) => {
    const parsed = jsonString(sourceBindingSchema).safeParse(content);
    if (!sourceBindingPathSchema.safeParse(path).success || !parsed.success)
      throw new OntologyInvalid({ reason: "source" });
    return parsed.data;
  });
  const byId = new Map(bindings.map((binding) => [binding.id, binding]));
  if (byId.size !== bindings.length)
    throw new OntologyInvalid({ reason: "duplicate" });
  for (const binding of bindings) {
    const entity = graph.types.find(
      ({ id }) => id === binding.ontology.entityType
    );
    if (!entity) throw new OntologyInvalid({ reason: "type" });
    if (binding.ontology.identity.length !== binding.relation.primaryKeySize)
      throw new OntologyInvalid({ reason: "source" });
    for (const property of entity.properties) {
      if (
        property.required &&
        !Object.hasOwn(binding.ontology.properties, property.id)
      )
        throw new OntologyInvalid({ reason: "property" });
    }
    for (const [id, columnId] of Object.entries(binding.ontology.properties)) {
      const property = entity.properties.find((item) => item.id === id);
      const column = binding.columns.find((item) => item.id === columnId);
      // A string stores exact wire text; it does not declare decimal arithmetic.
      const type =
        column?.type === "text" || column?.type === "decimal"
          ? "string"
          : column?.type;
      if (
        !property ||
        !column ||
        property.type !== type ||
        (property.required && column.nullable)
      )
        throw new OntologyInvalid({ reason: "property" });
    }
    for (const mapping of binding.ontology.relations) {
      const relation = graph.relations.find(
        ({ id }) => id === mapping.relation
      );
      const target = byId.get(mapping.targetBindingId);
      if (
        !relation ||
        !target ||
        relation.from !== entity.id ||
        relation.to !== target.ontology.entityType ||
        mapping.targetColumns.length !== target.ontology.identity.length ||
        mapping.targetColumns.some(
          (id, index) => id !== target.ontology.identity[index]
        ) ||
        mapping.columns.some((id, index) => {
          const column = binding.columns.find((item) => item.id === id);
          const targetColumn = target.columns.find(
            (item) => item.id === mapping.targetColumns[index]
          );
          return (
            !column ||
            !targetColumn ||
            targetColumn.nullable ||
            column.type !== targetColumn.type
          );
        })
      )
        throw new OntologyInvalid({ reason: "link" });
    }
  }
}

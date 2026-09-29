import type { z } from "zod";
import type {
  OntologySchema,
  OntologySourceSchema,
  OntologyClaimSchema,
} from "@shared/workspaces/ontology";

type Graph = z.output<typeof OntologySchema>;

export function ontologyEvidenceTargets(
  entity: Graph["entities"][number],
  graph: Graph
) {
  return [
    {
      kind: "record" as const,
      id: "record",
      name: "Registro",
      sources: entity.sources,
      validTime: null,
    },
    ...Object.entries(entity.properties).map(([key, claim]) => ({
      kind: "property" as const,
      id: `property:${key}`,
      property: key,
      name:
        graph.types
          .find((type) => type.id === entity.type)
          ?.properties.find((property) => property.id === key)?.name ?? key,
      sources: claim.sources,
      validTime: claim.validTime,
    })),
    ...graph.links
      .filter((link) => link.from === entity.id || link.to === entity.id)
      .map((link) => ({
        kind: "link" as const,
        id: JSON.stringify([link.type, link.from, link.to]),
        name: `${graph.relations.find((relation) => relation.id === link.type)?.name ?? link.type} · ${graph.entities.find((item) => item.id === (link.from === entity.id ? link.to : link.from))?.name ?? ""}`,
        sources: link.sources,
        validTime: link.validTime,
      })),
  ];
}

export function linkOntologyEvidence(
  graph: Graph,
  entityId: string,
  target: ReturnType<typeof ontologyEvidenceTargets>[number],
  citation: z.output<typeof OntologySourceSchema>,
  validTime: z.output<typeof OntologyClaimSchema>["validTime"]
) {
  const sources = [...target.sources, citation];
  if (target.kind === "link")
    return {
      ...graph,
      links: graph.links.map((link) =>
        JSON.stringify([link.type, link.from, link.to]) === target.id
          ? { ...link, sources, validTime }
          : link
      ),
    };
  return {
    ...graph,
    entities: graph.entities.map((entity) => {
      if (entity.id !== entityId) return entity;
      if (target.kind === "record") return { ...entity, sources };
      const claim = entity.properties[target.property];
      if (!claim) return entity;
      return {
        ...entity,
        properties: {
          ...entity.properties,
          [target.property]: { ...claim, sources, validTime },
        },
      };
    }),
  };
}

import { expect, test } from "vitest";
import { emptyOntology, OntologySchema } from "@zoen/companion-ui/ontology";
import { linkOntologyEvidence, ontologyEvidenceTargets } from "./evidence";

test.each(["property", "link"])(
  "correcting %s validity retains its exact citation without duplication",
  (kind) => {
    const citation = {
      path: "knowledge/status.md",
      revision: "a".repeat(40),
      excerpt: "The status is active from September 1 until October 1.",
    };
    const graph = OntologySchema.parse({
      ...emptyOntology,
      entities: [
        {
          id: "project",
          name: "Project",
          type: "project",
          sources: [],
          properties: {
            status: { value: "active", sources: [citation], validTime: null },
          },
        },
        { id: "task", name: "Task", type: "task", sources: [], properties: {} },
      ],
      links: [
        {
          type: "part_of",
          from: "task",
          to: "project",
          sources: [citation],
          validTime: null,
        },
      ],
    });
    const entity = graph.entities[0];
    if (!entity) throw new Error("Missing synthetic project");
    const target = ontologyEvidenceTargets(entity, graph).find(
      (item) => item.kind === kind
    );
    if (!target) throw new Error("Missing synthetic evidence target");
    const validTime = { from: "2026-09-01", until: "2026-10-01" };
    const updated = OntologySchema.parse(
      linkOntologyEvidence(graph, "project", target, citation, validTime)
    );
    const claim =
      kind === "property"
        ? updated.entities[0]?.properties.status
        : updated.links[0];
    expect(claim).toMatchObject({ sources: [citation], validTime });
    expect(graph.entities[0]?.properties.status?.validTime).toBeNull();
    expect(graph.links[0]?.validTime).toBeNull();
  }
);

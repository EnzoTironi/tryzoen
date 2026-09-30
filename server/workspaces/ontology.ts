import { jsonString } from "@shared/validation";
import type { z } from "zod";
import {
  OntologyInvalid,
  ontologyCitations,
  ontologyValidOn,
  validateOntology,
} from "./ontology-validation";

import {
  emptyOntology,
  OntologyActionSchema,
  OntologyReadSchema,
  ontologyPath,
  OntologySchema,
} from "@zoen/companion-ui/ontology";
import type { WorkspaceWriteSchema } from "./repository";
import { WorkspaceRepository, WorkspaceRepositoryError } from "./repository";
import { requireWorkspaceAccess, type WorkspaceActorSchema } from "./access";

function ontologyPassageStates(
  graph: z.output<typeof OntologySchema>,
  documents: Awaited<
    ReturnType<typeof WorkspaceRepository.selection>
  >["documents"]
) {
  return ontologyCitations(graph).map((source) => {
    const content = documents.find(
      (file) => file.path === source.path
    )?.content;
    return {
      path: source.path,
      revision: source.revision,
      excerpt: source.excerpt,
      status:
        content === undefined
          ? ("unavailable" as const)
          : content.includes(source.excerpt)
            ? ("passage-present" as const)
            : ("passage-changed" as const),
    };
  });
}

export const readOntology = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof OntologyReadSchema> = {}
) {
  const input = OntologyReadSchema.parse(raw);
  const access = await requireWorkspaceAccess(actor);
  const listing = await WorkspaceRepository.read(actor);
  const selection = await WorkspaceRepository.selection(actor, [ontologyPath], {
    revision: input.revision,
    asOf: input.asOf,
  });
  const historical = !!input.revision || !!input.asOf;
  if (!historical && listing.revision !== selection.revision)
    throw new WorkspaceRepositoryError({ reason: "conflict" });
  const document = selection.documents[0];
  const original = document
    ? await validateOntology(
        await jsonString(OntologySchema).parseAsync(document.content)
      )
    : emptyOntology;
  const graph = input.validOn
    ? ontologyValidOn(original, input.validOn)
    : historical
      ? { ...original, actions: [] }
      : original;
  const citations = ontologyCitations(graph);
  const current = citations.length
    ? await WorkspaceRepository.selection(actor, [
        ...new Set(citations.map((source) => source.path)),
      ])
    : { revision: listing.revision, documents: [] };
  if (current.revision !== listing.revision)
    throw new WorkspaceRepositoryError({ reason: "conflict" });
  return {
    graph,
    revision: selection.revision,
    asOf: input.asOf ?? null,
    validOn: input.validOn ?? null,
    sourceCheckedAtRevision: current.revision,
    sources: ontologyPassageStates(graph, current.documents),
    mayManage:
      !historical &&
      !input.validOn &&
      access.role !== "member" &&
      !!actor.authSessionId,
  };
};

export const publishOntology = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: Pick<
    z.output<typeof WorkspaceWriteSchema>,
    "operationId" | "expectedRevision"
  > & { readonly graph: z.output<typeof OntologySchema> },
  action?: Pick<z.output<typeof OntologyActionSchema>, "actionId" | "entityId">
) {
  await requireWorkspaceAccess(actor, true);
  const graph = await validateOntology(input.graph);
  const repository = WorkspaceRepository;
  return await repository.write(
    actor,
    {
      path: ontologyPath,
      content: JSON.stringify(graph, null, 2),
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
    },
    { kind: "ontology", action }
  );
};

export const applyOntologyAction = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof OntologyActionSchema> &
    Pick<
      z.output<typeof WorkspaceWriteSchema>,
      "operationId" | "expectedRevision"
    >
) {
  await requireWorkspaceAccess(actor, true);
  const actionInput = await OntologyActionSchema.parseAsync(input);
  const graph =
    input.expectedRevision === null
      ? (await readOntology(actor)).graph
      : await validateOntology(
          await jsonString(OntologySchema).parseAsync(
            (
              await WorkspaceRepository.read(
                actor,
                ontologyPath,
                input.expectedRevision
              )
            ).content
          )
        );
  const action = graph.actions.find((item) => item.id === actionInput.actionId);
  const entity = graph.entities.find(
    (item) => item.id === actionInput.entityId
  );
  if (!action || !entity || entity.type !== action.entityType)
    throw new OntologyInvalid({ reason: "action" });
  return await publishOntology(
    actor,
    {
      ...input,
      graph: {
        ...graph,
        entities: graph.entities.map((item) =>
          item.id === entity.id
            ? Object.assign({}, item, {
                properties: {
                  ...item.properties,
                  [action.property]: {
                    value: actionInput.value,
                    sources: actionInput.sources,
                    validTime: actionInput.validTime,
                  },
                },
              })
            : item
        ),
      },
    },
    { actionId: actionInput.actionId, entityId: actionInput.entityId }
  );
};

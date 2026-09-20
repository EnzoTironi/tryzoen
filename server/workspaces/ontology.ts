import { jsonString } from "@shared/validation";
import type { z } from "zod";
import { validateOntology } from "./ontology-validation";

import {
  emptyOntology,
  OntologyActionSchema,
  OntologyInvalid,
  ontologyPath,
  OntologySchema,
} from "@shared/workspaces/ontology";
import type { WorkspaceWriteSchema } from "./repository";
import { WorkspaceRepository } from "./repository";
import { requireWorkspaceAccess, type WorkspaceActorSchema } from "./access";

export const readOntology = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const access = await requireWorkspaceAccess(actor);
  const selection = await WorkspaceRepository.selection(actor, [ontologyPath]);
  const document = selection.documents[0];
  const graph = document
    ? await Promise.try(async () =>
        jsonString(OntologySchema).parseAsync(document.content)
      ).then(validateOntology)
    : emptyOntology;
  return {
    graph,
    revision: selection.revision,
    mayManage: access.role !== "member" && !!actor.authSessionId,
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
  const checked = new Set<string>();
  for (const entity of graph.entities)
    for (const source of entity.sources) {
      const key = `${source.revision}:${source.path}`;
      if (checked.has(key)) continue;
      if (source.path.includes(".."))
        throw new OntologyInvalid({ reason: "source" });
      await repository.read(actor, source.path, source.revision);
      checked.add(key);
    }
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
                  [action.property]: actionInput.value,
                },
              })
            : item
        ),
      },
    },
    { actionId: actionInput.actionId, entityId: actionInput.entityId }
  );
};

import { isValid } from "@shared/validation";
import { z } from "zod";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
import { GitRevisionSchema } from "./git";
import {
  parseSkillDocument,
  PublishedSkillPath,
  SkillProposalPath,
  skillPathFromProposal,
} from "./skill-document";
import {
  WorkspaceRepository,
  WorkspaceRepositoryError,
  WorkspaceWriteSchema,
} from "./repository";
export const PublishSkillProposalSchema = z.object({
  operationId: WorkspaceWriteSchema.shape.operationId,
  expectedRevision: WorkspaceWriteSchema.shape.expectedRevision,
  proposal: SkillProposalPath,
});
export const RollbackSkillSchema = z.object({
  operationId: WorkspaceWriteSchema.shape.operationId,
  expectedRevision: WorkspaceWriteSchema.shape.expectedRevision,
  path: PublishedSkillPath,
  revision: GitRevisionSchema,
});
function invalid(): never {
  throw new WorkspaceRepositoryError({
    reason: "invalid_input",
  });
}
export const listSkillProposals = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  if (actor.agentGrantId) throw new WorkspaceAccessDenied();
  await requireWorkspaceAccess(actor);
  const repository = WorkspaceRepository;
  const listing = await repository.read(actor);
  const stored = await repository.selection(
    actor,
    listing.files.filter((value: unknown) => isValid(SkillProposalPath, value))
  );
  return stored.documents.map((document) => ({
    path: document.path,
    title: parseSkillDocument(document.content)?.title ?? document.path,
    revision: stored.revision,
  }));
};
export const publishSkillProposal = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof PublishSkillProposalSchema>
) {
  await requireWorkspaceAccess(actor, true);
  const input = await Promise.try(async () =>
    PublishSkillProposalSchema.parseAsync(raw)
  ).catch(() => {
    return invalid();
  });
  const path = skillPathFromProposal(input.proposal);
  if (!isValid(PublishedSkillPath, path)) return invalid();
  const repository = WorkspaceRepository;
  const proposal = await repository.read(
    actor,
    input.proposal,
    input.expectedRevision ?? undefined
  );
  if (proposal.content === null || !parseSkillDocument(proposal.content))
    return invalid();
  return await repository.write(
    actor,
    {
      path,
      content: proposal.content,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
    },
    {
      kind: "publication",
      proposal: input.proposal,
    }
  );
};
export const rollbackSkill = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof RollbackSkillSchema>
) {
  await requireWorkspaceAccess(actor, true);
  const input = await Promise.try(async () =>
    RollbackSkillSchema.parseAsync(raw)
  ).catch(() => {
    return invalid();
  });
  const repository = WorkspaceRepository;
  const previous = await repository.read(actor, input.path, input.revision);
  if (previous.content === null || !parseSkillDocument(previous.content))
    return invalid();
  return await repository.write(
    actor,
    {
      path: input.path,
      content: previous.content,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
    },
    {
      kind: "rollback",
      revision: input.revision,
    }
  );
};

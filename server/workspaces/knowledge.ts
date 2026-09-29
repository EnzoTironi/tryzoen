import {
  knowledgeProposalListSchema,
  knowledgeProposalPathSchema,
  knowledgeProposalReviewSchema,
  knowledgeProposalSchema,
  knowledgeRoutingPath,
  knowledgeRoutingSchema,
} from "@zoen/companion-ui/knowledge";
import { z } from "zod";
import { isValid, jsonString } from "@shared/validation";
import {
  WorkspaceWriteSchema,
  WorkspaceRepository,
  WorkspaceRepositoryError,
} from "./repository";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";

export const ProposeKnowledgeSchema = z
  .object(knowledgeProposalSchema.shape)
  .omit({ baseRevision: true })
  .extend({
    operationId: WorkspaceWriteSchema.shape.operationId,
    expectedRevision: WorkspaceWriteSchema.shape.expectedRevision,
  });
export const ReviewKnowledgeSchema = WorkspaceWriteSchema.pick({
  operationId: true,
  expectedRevision: true,
}).extend({
  proposal: knowledgeProposalPathSchema,
  decision: z.enum(["approve", "reject"]),
});

function privateReview(actor: z.output<typeof WorkspaceActorSchema>) {
  if (!actor.authSessionId || actor.agentGrantId || actor.groupBindingId)
    throw new WorkspaceAccessDenied();
}

export const DiscoverKnowledgeSchema = z.strictObject({
  query: z.string().trim().min(1).max(200).optional(),
  ids: z.array(z.uuid()).max(6).optional(),
});

/** A routing file names published knowledge; it cannot create visibility. */
export async function discoverKnowledge(
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof DiscoverKnowledgeSchema>
) {
  const input = DiscoverKnowledgeSchema.parse(raw);
  const listing = await WorkspaceRepository.read(actor);
  const roots = await WorkspaceRepository.selection(actor, [
    "knowledge/purpose.md",
    knowledgeRoutingPath,
  ]);
  if (roots.revision !== listing.revision)
    throw new WorkspaceRepositoryError({ reason: "conflict" });
  const routing = roots.documents.find(
    (document) => document.path === knowledgeRoutingPath
  );
  const records = routing
    ? jsonString(knowledgeRoutingSchema)
        .parse(routing.content)
        .records.filter((record) =>
          record.paths.every((path) => listing.files.includes(path))
        )
    : [];
  const terms = input.query?.toLocaleLowerCase().split(/\s+/u) ?? [];
  const ranked = records
    .map((record) => ({
      record,
      score: terms.reduce(
        (score, term) =>
          score +
          Number(
            [record.title, record.summary, ...record.terms]
              .join(" ")
              .toLocaleLowerCase()
              .includes(term)
          ),
        0
      ),
    }))
    .filter((item) => terms.length === 0 || item.score > 0)
    .toSorted(
      (a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id)
    );
  const selected = records.filter((record) => input.ids?.includes(record.id));
  const paths = [...new Set(selected.flatMap((record) => record.paths))];
  const loaded = paths.length
    ? await WorkspaceRepository.selection(actor, paths)
    : { revision: roots.revision, documents: [] };
  if (loaded.revision !== roots.revision)
    throw new WorkspaceRepositoryError({ reason: "conflict" });
  let remaining = 24_000;
  const documents = loaded.documents.map((document) => {
    const content = document.content.slice(0, Math.min(4000, remaining));
    remaining -= content.length;
    return {
      path: document.path,
      content,
      nextOffset:
        content.length < document.content.length ? content.length : null,
    };
  });
  const purpose = roots.documents.find(
    (document) => document.path === "knowledge/purpose.md"
  );
  return {
    revision: roots.revision,
    purpose: purpose
      ? {
          path: purpose.path,
          content: purpose.content.slice(0, 3000),
          nextOffset: purpose.content.length > 3000 ? 3000 : null,
        }
      : null,
    records: input.ids
      ? selected
      : ranked.map((item) => item.record).slice(0, 12),
    more: !input.ids && ranked.length > 12,
    documents,
  };
}

export async function proposeKnowledge(
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof ProposeKnowledgeSchema>
) {
  privateReview(actor);
  await requireWorkspaceAccess(actor);
  const { operationId, expectedRevision, ...body } =
    await ProposeKnowledgeSchema.parseAsync(raw);
  const proposal = knowledgeProposalSchema.parse({
    ...body,
    baseRevision: expectedRevision,
  });
  const path = `proposals/knowledge/${operationId}.json`;
  const result = await WorkspaceRepository.write(
    actor,
    {
      operationId,
      expectedRevision,
      path,
      content: JSON.stringify(proposal, null, 2),
    },
    { kind: "agent" }
  );
  return { path, ...result };
}

export async function listKnowledgeProposals(
  actor: z.output<typeof WorkspaceActorSchema>
) {
  privateReview(actor);
  const access = await requireWorkspaceAccess(actor);
  const listing = await WorkspaceRepository.read(actor);
  const selection = await WorkspaceRepository.selection(
    actor,
    listing.files
      .filter((path) => isValid(knowledgeProposalPathSchema, path))
      .slice(0, 24)
  );
  return knowledgeProposalListSchema.parse({
    revision: selection.revision,
    canReview: access.role !== "member",
    items: selection.documents.map(({ path, content }) => {
      const proposal = jsonString(knowledgeProposalSchema).parse(content);
      return {
        path,
        title: proposal.title,
        summary: proposal.summary,
        files: proposal.changes.length,
      };
    }),
  });
}

export async function readKnowledgeProposal(
  actor: z.output<typeof WorkspaceActorSchema>,
  path: string
) {
  privateReview(actor);
  const access = await requireWorkspaceAccess(actor);
  const stored = await WorkspaceRepository.read(
    actor,
    knowledgeProposalPathSchema.parse(path)
  );
  const proposal = jsonString(knowledgeProposalSchema).parse(stored.content);
  const paths = [
    ...new Set([
      ...proposal.changes.map((change) => change.path),
      ...proposal.dependencies,
      ...proposal.evidence
        .filter((item) => item.kind === "file")
        .map((item) => item.path),
    ]),
  ];
  // Reads use the captured head. A concurrent save cannot produce a mixed preview;
  // the publication's CAS still checks this exact head after the human decides.
  const current = await WorkspaceRepository.selection(
    actor,
    paths,
    stored.revision ?? undefined
  );
  const base =
    proposal.baseRevision === null
      ? null
      : await WorkspaceRepository.selection(
          actor,
          paths,
          proposal.baseRevision
        );
  const before = new Map(
    current.documents.map(({ path: filename, content }) => [filename, content])
  );
  const original = new Map(
    base?.documents.map(({ path: filename, content }) => [filename, content])
  );
  const conflicts = paths.filter(
    (filename) =>
      (before.get(filename) ?? null) !== (original.get(filename) ?? null)
  );
  const citations = new Map<string, string[]>();
  for (const evidence of proposal.evidence) {
    if (evidence.kind !== "file") continue;
    citations.set(evidence.revision, [
      ...(citations.get(evidence.revision) ?? []),
      evidence.path,
    ]);
  }
  for (const [revision, filenames] of citations) {
    const cited = await WorkspaceRepository.selection(
      actor,
      filenames,
      revision
    );
    for (const evidence of proposal.evidence) {
      if (evidence.kind !== "file" || evidence.revision !== revision) continue;
      if (
        !cited.documents
          .find((document) => document.path === evidence.path)
          ?.content.includes(evidence.excerpt) &&
        !conflicts.includes(evidence.path)
      )
        conflicts.push(evidence.path);
    }
  }
  return knowledgeProposalReviewSchema.parse({
    path,
    revision: stored.revision,
    canReview: access.role !== "member",
    proposal,
    conflicts,
    changes: proposal.changes.map((change) => ({
      path: change.path,
      before: before.get(change.path) ?? null,
      after: change.content,
    })),
  });
}

export async function reviewKnowledgeProposal(
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof ReviewKnowledgeSchema>
) {
  privateReview(actor);
  await requireWorkspaceAccess(actor, true);
  const input = await ReviewKnowledgeSchema.parseAsync(raw);
  // Load at the review's historical head so identical retries remain idempotent
  // even after the proposal has been removed by the successful publication.
  const saved = await WorkspaceRepository.read(
    actor,
    input.proposal,
    input.expectedRevision ?? undefined
  );
  if (input.decision === "reject")
    return WorkspaceRepository.write(
      actor,
      {
        operationId: input.operationId,
        expectedRevision: input.expectedRevision,
        path: input.proposal,
        content: null,
      },
      { kind: "knowledge-rejection" }
    );
  const proposal = jsonString(knowledgeProposalSchema).parse(saved.content);
  const head = await WorkspaceRepository.read(actor);
  if (head.revision === input.expectedRevision) {
    const review = await readKnowledgeProposal(actor, input.proposal);
    if (review.conflicts.length)
      throw new WorkspaceRepositoryError({ reason: "conflict" });
  }
  // A stale head reaches only the publisher's replay/CAS gate, never a new write.
  return WorkspaceRepository.publish(
    actor,
    {
      operationId: input.operationId,
      expectedRevision: input.expectedRevision,
      changes: proposal.changes,
    },
    { kind: "knowledge-publication", proposal: input.proposal }
  );
}

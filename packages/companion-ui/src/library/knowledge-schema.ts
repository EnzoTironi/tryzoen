import { z } from "zod";

import { WorkspacePathSchema, GitRevisionSchema } from "./files-schema";

export const knowledgePathSchema = WorkspacePathSchema.refine((path) =>
  path.startsWith("knowledge/")
);
const revision = GitRevisionSchema;
export const knowledgeProposalPathSchema = WorkspacePathSchema.refine((path) =>
  path.startsWith("proposals/knowledge/")
);
export const knowledgeProposalSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(2000),
    baseRevision: revision.nullable(),
    changes: z
      .array(
        z
          .object({
            path: knowledgePathSchema,
            content: z.string().max(262_144).nullable(),
          })
          .strict()
      )
      .min(1)
      .max(20)
      .refine(
        (changes) =>
          new Set(changes.map(({ path }) => path)).size === changes.length,
        "Each file must appear once"
      ),
    dependencies: z
      .array(knowledgePathSchema)
      .max(20)
      .refine(
        (paths) => new Set(paths).size === paths.length,
        "Each dependency must appear once"
      ),
    evidence: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("file"),
              path: knowledgePathSchema,
              revision,
              excerpt: z.string().min(1).max(2000),
            })
            .strict(),
          z
            .object({
              kind: z.literal("link"),
              url: z
                .url()
                .max(2048)
                .refine((url) => /^https?:\/\//u.test(url)),
              title: z.string().min(1).max(200),
              excerpt: z.string().min(1).max(2000),
            })
            .strict(),
        ])
      )
      .min(1)
      .max(20)
      .refine(
        (items) =>
          new Set(items.map((item) => JSON.stringify(item))).size ===
          items.length,
        "Each citation must be unique"
      ),
  })
  .strict()
  .refine(
    (proposal) =>
      new Set([
        ...proposal.changes.map(({ path }) => path),
        ...proposal.dependencies,
        ...proposal.evidence
          .filter((item) => item.kind === "file")
          .map((item) => item.path),
      ]).size <= 24,
    "A proposal may reference at most 24 workspace files"
  );
export const knowledgeProposalListSchema = z.object({
  revision: revision.nullable(),
  canReview: z.boolean(),
  items: z
    .array(
      z.object({
        path: knowledgeProposalPathSchema,
        title: z.string(),
        summary: z.string(),
        files: z.number().int().min(1).max(20),
      })
    )
    .max(24),
});
export const knowledgeProposalReviewSchema = z.object({
  path: knowledgeProposalPathSchema,
  revision,
  canReview: z.boolean(),
  proposal: knowledgeProposalSchema,
  changes: z
    .array(
      z.object({
        path: knowledgePathSchema,
        before: z.string().nullable(),
        after: z.string().nullable(),
      })
    )
    .max(20),
  conflicts: z.array(knowledgePathSchema).max(60),
});

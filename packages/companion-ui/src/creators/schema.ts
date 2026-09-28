import { z } from "zod";

export const creatorExampleSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(24000),
    source: z.string().trim().min(1).max(1000),
    rights: z.enum(["original", "permission", "public-domain"]),
  })
  .strict();

export const creatorDraftContentSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(400),
    playbook: z.string().max(64000),
    examples: z
      .array(creatorExampleSchema)
      .max(20)
      .refine(
        (examples) =>
          new Set(examples.map((example) => example.id)).size ===
          examples.length,
        "Each example must have its own identity."
      ),
  })
  .strict();

export const creatorEvaluationCaseSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().trim().min(1).max(120),
  question: z.string().trim().min(1).max(4000),
  criteria: z.string().trim().min(1).max(4000),
});

export const creatorEvaluationCasesSchema = z
  .array(creatorEvaluationCaseSchema)
  .max(20)
  .refine(
    (cases) => new Set(cases.map((item) => item.id)).size === cases.length,
    "Each evaluation case must have its own identity."
  );

export const creatorEvaluationSchema = z.strictObject({
  revision: z.uuid(),
  cases: creatorEvaluationCasesSchema,
  updatedAt: z.number(),
});

export const creatorEvaluationSaveSchema = z.strictObject({
  draftId: z.uuid(),
  expectedRevision: z.uuid().nullable(),
  cases: creatorEvaluationCasesSchema,
});

export const creatorEvaluationSnapshotSchema = z.strictObject({
  revision: z.uuid(),
  case: creatorEvaluationCaseSchema,
});

export const creatorDraftSchema = z.object({
  username: z.string().nullable(),
  id: z.uuid(),
  revision: z.uuid(),
  content: creatorDraftContentSchema,
  evaluation: creatorEvaluationSchema.nullable(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
});

export const creatorDraftSaveSchema = z
  .object({
    id: z.uuid(),
    expectedRevision: z.uuid().nullable(),
    content: creatorDraftContentSchema,
  })
  .strict();

export const creatorDraftStateSchema = z
  .object({
    id: z.uuid(),
    expectedRevision: z.uuid(),
    archived: z.boolean(),
  })
  .strict();

export const creatorPreviewRequestSchema = z.strictObject({
  id: z.uuid(),
  draftId: z.uuid(),
  revision: z.uuid(),
  kind: z.enum(["answer", "playbook"]),
  question: creatorEvaluationCaseSchema.shape.question,
  pilotId: z.uuid().optional(),
  caseRef: z.strictObject({ id: z.uuid(), revision: z.uuid() }).optional(),
});

export const creatorPreviewReviewContentSchema = z.strictObject({
  criteria: z.string().trim().min(1).max(4000),
  verdict: z.enum(["useful", "needs-revision", "unsafe-or-unsupported"]),
  notes: z.string().trim().min(1).max(8000),
});

export const creatorPreviewReviewSchema = z.strictObject({
  revision: z.uuid(),
  content: creatorPreviewReviewContentSchema,
  updatedAt: z.number(),
});

export const creatorPreviewReviewSaveSchema = z.strictObject({
  id: z.uuid(),
  expectedRevision: z.uuid().nullable(),
  content: creatorPreviewReviewContentSchema,
});

export const creatorPreviewModelSchema = z.strictObject({
  provider: z.string().min(1).max(200),
  modelId: z.string().min(1).max(200),
});

export const creatorPreviewSchema = creatorPreviewRequestSchema
  .omit({ caseRef: true })
  .extend({
    pilotId: z.uuid().nullable(),
    evaluation: creatorEvaluationSnapshotSchema.nullable(),
    title: z.string().min(1).max(80),
    status: z.enum(["pending", "running", "completed", "failed", "expired"]),
    response: z.string().max(32000).nullable(),
    createdAt: z.number(),
    expiresAt: z.number(),
    review: creatorPreviewReviewSchema.nullable(),
    models: z.array(creatorPreviewModelSchema).max(8),
    startedAt: z.number().nullable(),
    finishedAt: z.number().nullable(),
  });

export const creatorPreviewListSchema = z.array(creatorPreviewSchema).max(20);
export const creatorPreviewExportSchema = creatorPreviewSchema.extend({
  snapshot: creatorDraftContentSchema,
});

export const creatorReleaseEvidenceSchema = creatorPreviewSchema
  .omit({ kind: true, pilotId: true })
  .strip()
  .extend({
    status: z.literal("completed"),
    response: z.string().min(1).max(32000),
    evaluation: creatorEvaluationSnapshotSchema,
    review: creatorPreviewReviewSchema.extend({
      content: creatorPreviewReviewContentSchema.extend({
        verdict: z.literal("useful"),
      }),
    }),
    models: z.array(creatorPreviewModelSchema).min(1).max(8),
    startedAt: z.number(),
    finishedAt: z.number(),
  });

export const creatorReleaseRequestSchema = z.strictObject({
  id: z.uuid(),
  draftId: z.uuid(),
  revision: z.uuid(),
  evaluationRevision: z.uuid(),
  evidence: z
    .array(z.strictObject({ id: z.uuid(), reviewRevision: z.uuid() }))
    .min(1)
    .max(20),
  notes: z.string().trim().min(1).max(8000),
});

export const creatorReleaseSchema = creatorReleaseRequestSchema
  .omit({ evidence: true })
  .extend({
    content: creatorDraftContentSchema,
    evidence: z.array(creatorReleaseEvidenceSchema).min(1).max(20),
    createdAt: z.number(),
  });

export const creatorReleaseListSchema = z
  .array(creatorReleaseSchema.omit({ content: true, evidence: true }))
  .max(50);
export const creatorReleaseCandidateSchema = z.object({
  draft: creatorDraftSchema,
  evidence: z.array(creatorReleaseEvidenceSchema).max(20),
  issues: z.array(z.string()).max(22),
});

export const creatorDraftListSchema = z
  .array(
    creatorDraftSchema.omit({ content: true, evaluation: true }).extend({
      title: creatorDraftContentSchema.shape.title,
      description: creatorDraftContentSchema.shape.description,
      examples: z.number().int().min(0).max(20),
    })
  )
  .max(100);

export const creatorPlaybookTemplate = `# How I help

Describe the audience, useful outcomes and situations this specialist can handle.

## Strategies

For each strategy, explain when to use it, what context is needed and what a useful response looks like.

## Limits and escalation

Explain when to ask for more information, decline a request or involve a person.

## Sources

Credit the examples and sources you have permission to use.
`;

export const creatorExampleTemplate = `# Situation

Describe a representative case without personal or confidential information.

## What I noticed

Record the observations that mattered to your decision.

## Strategy and alternatives

Explain the strategy you chose and why other approaches did not fit.

## Useful response

Write an example of the response you would want the specialist to offer.

## Limits

Describe what this example does not justify and when someone should take over.
`;

export const creatorPilotInviteSchema = z.strictObject({
  id: z.uuid(),
  releaseId: z.uuid(),
  username: z.string().regex(/^[a-z][a-z0-9_]{2,29}$/),
  shareTeaching: z.literal(true),
});

export const creatorPilotActionSchema = z.strictObject({
  id: z.uuid(),
  action: z.enum(["accept", "decline", "withdraw"]),
});

export const creatorPilotSchema = z.object({
  username: z.string().nullable(),
  id: z.uuid(),
  releaseId: z.uuid(),
  draftId: z.uuid(),
  revision: z.uuid(),
  title: creatorDraftContentSchema.shape.title,
  description: creatorDraftContentSchema.shape.description,
  creatorName: z.string(),
  recipientName: z.string(),
  isCreator: z.boolean(),
  status: z.enum(["pending", "active", "declined", "withdrawn"]),
  createdAt: z.number(),
});

export const creatorPilotListSchema = z.array(creatorPilotSchema).max(100);
export const creatorPilotTeachingSchema = creatorPilotSchema.extend({
  content: creatorDraftContentSchema,
});

export const creatorPilotFeedbackSchema = z.object({
  revision: z.uuid(),
  content: z.string().trim().min(1).max(16000),
  updatedAt: z.number(),
});
export const creatorPilotFeedbackViewSchema = creatorPilotSchema.extend({
  feedback: creatorPilotFeedbackSchema.nullable(),
});
export const creatorPilotFeedbackSaveSchema = z.strictObject({
  id: z.uuid(),
  expectedRevision: z.uuid().nullable(),
  content: creatorPilotFeedbackSchema.shape.content,
  shareWithCreator: z.literal(true),
});

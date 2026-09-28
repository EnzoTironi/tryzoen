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

export const creatorDraftSchema = z.object({
  id: z.uuid(),
  revision: z.uuid(),
  content: creatorDraftContentSchema,
  updatedAt: z.iso.datetime(),
});

export const creatorDraftSaveSchema = z
  .object({
    id: z.uuid(),
    expectedRevision: z.uuid().nullable(),
    content: creatorDraftContentSchema,
  })
  .strict();

export const creatorDraftListSchema = z
  .array(
    creatorDraftSchema.omit({ content: true }).extend({
      title: creatorDraftContentSchema.shape.title,
      description: creatorDraftContentSchema.shape.description,
      examples: z.number().int().min(0).max(20),
    })
  )
  .max(20);

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

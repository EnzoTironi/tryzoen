import { z } from "zod";

export const workstreamIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

const workstreamStatusSchema = z.enum([
  "active",
  "waiting",
  "completed",
  "cancelled",
]);

const workstreamContentSchema = z.strictObject({
  kind: z
    .enum(["goal", "tracking"])
    .optional()
    .describe(
      "A goal works toward a defined outcome; tracking follows an ongoing situation. Omit for a goal. Neither kind enables background execution."
    ),
  parentId: workstreamIdSchema
    .nullish()
    .describe(
      "Null or omitted for a top-level goal; otherwise the ID of an existing top-level parent. Never use the goal’s own ID or a placeholder such as root."
    ),
  progress: z
    .strictObject({
      title: z.string().trim().min(1).max(120),
      description: z.string().trim().min(1).max(800),
    })
    .optional(),
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(500),
  status: workstreamStatusSchema,
  notes: z.string().trim().max(3_000),
  nextStep: z.string().trim().max(300),
  sources: z
    .array(
      z.strictObject({
        reference: z.string().trim().min(1).max(300),
        observation: z.string().trim().min(1).max(300),
        observedAt: z.iso.datetime({ offset: true }),
      })
    )
    .max(8),
});

export const saveWorkstreamSchema = z.strictObject({
  id: workstreamIdSchema,
  expectedRevision: z.number().int().min(0),
  content: workstreamContentSchema,
});

export const findWorkstreamsSchema = z.strictObject({
  query: z.string().trim().max(200).default(""),
  status: workstreamStatusSchema.optional(),
  offset: z.number().int().min(0).default(0),
});

export const forgetWorkstreamSchema = saveWorkstreamSchema.pick({
  id: true,
  expectedRevision: true,
});

export type WorkstreamContent = z.infer<typeof workstreamContentSchema>;

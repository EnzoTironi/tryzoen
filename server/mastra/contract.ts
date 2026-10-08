import { z } from "zod";
import { GitRevisionSchema } from "../../packages/companion-ui/src/library/files-schema";
import { LearnedClaimBodySchema } from "../../packages/companion-ui/src/learned/claim";

export const pilotActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("note"),
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(8000),
    path: z.string().regex(/^knowledge\/notes\/mastra\/[a-f0-9-]{36}\.md$/u),
    expectedRevision: GitRevisionSchema.nullable(),
  }),
  z.object({
    kind: z.literal("remember"),
    claimId: z.uuid(),
    body: LearnedClaimBodySchema,
    expectedRevision: GitRevisionSchema.nullable(),
  }),
]);
export const pilotPlanSchema = z.object({
  reply: z.string().max(16000),
  action: pilotActionSchema.nullable(),
});
export const pilotResultSchema = z.object({
  message: z.string(),
  receipt: z
    .object({ operationId: z.string(), revision: GitRevisionSchema })
    .nullable(),
});
export const pilotRunSchema = z.object({
  runId: z.uuid(),
  conversationId: z.uuid(),
  input: z.string().trim().min(1).max(8000),
  status: z.enum([
    "running",
    "suspended",
    "completed",
    "rejected",
    "cancelled",
    "failed",
  ]),
  plan: pilotPlanSchema.nullable(),
  result: pilotResultSchema.nullable(),
  createdAt: z.string(),
});
export const pilotConversationSchema = z.object({
  id: z.uuid(),
  title: z.string(),
});
export const pilotViewSchema = z.object({
  conversations: z.array(pilotConversationSchema).max(30),
  conversationId: z.uuid().nullable(),
  runs: z.array(pilotRunSchema).max(30),
});
export const pilotCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("create") }),
  z.object({
    command: z.literal("send"),
    conversationId: z.uuid(),
    runId: z.uuid(),
    text: pilotRunSchema.shape.input,
  }),
  z.object({
    command: z.literal("decide"),
    runId: z.uuid(),
    approved: z.boolean(),
  }),
  z.object({ command: z.literal("cancel"), runId: z.uuid() }),
]);

import { z } from "zod";

const replyReferenceSchema = z.union([
  z.strictObject({ kind: z.literal("current") }),
  z.strictObject({ id: z.string().min(1), kind: z.literal("task") }),
  z.strictObject({ id: z.uuid(), kind: z.literal("automation") }),
]);
export type ReplyReference = z.output<typeof replyReferenceSchema>;

const httpsUrlSchema = z
  .url()
  .trim()
  .regex(/^https:/iu);
const attachmentSchema = z.strictObject({
  kind: z.enum(["image", "video", "audio", "file"]),
  mimeType: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(180).optional(),
  url: httpsUrlSchema,
});
const textSchema = z.string().trim().min(1).max(20_000);
const attachmentsSchema = z.array(attachmentSchema).min(1).max(4);
const messageFields = {
  attachments: attachmentsSchema.optional(),
  kind: z.literal("message"),
  text: textSchema.optional(),
  replyTo: replyReferenceSchema.optional(),
};
const textMessageSchema = z.strictObject({
  ...messageFields,
  text: textSchema,
});
const attachmentMessageSchema = z.strictObject({
  ...messageFields,
  attachments: attachmentsSchema,
});
const linkOutputSchema = z.strictObject({
  kind: z.literal("link"),
  replyTo: replyReferenceSchema.optional(),
  url: httpsUrlSchema.max(2048),
});
export const sendMessageOutputSchema = z.union([
  textMessageSchema,
  attachmentMessageSchema,
  linkOutputSchema,
]);

const deliveryMetadata = { deliveryId: z.string().min(1).optional() };
const deliveredMessageSchema = z.union([
  textMessageSchema.extend(deliveryMetadata),
  attachmentMessageSchema.extend(deliveryMetadata),
  linkOutputSchema.extend(deliveryMetadata),
]);
export const sendMessageToolResultSchema = z.object({
  kind: z.literal("tool-result"),
  output: deliveredMessageSchema,
  toolName: z.literal("send_message"),
});

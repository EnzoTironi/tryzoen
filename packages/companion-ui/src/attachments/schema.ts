import type { FileUIPart } from "ai";
import { z } from "zod";
import { attachmentLimits, inlineAttachmentBytes } from "./limits";

export const inlineAttachmentSchema = z
  .object({
    type: z.literal("file"),
    filename: z.string().max(255).optional(),
    mediaType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/u),
    url: z
      .string()
      .max((attachmentLimits.bytes * 4) / 3 + 512)
      .regex(/^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/]*={0,2}$/u),
  })
  .refine(
    (file) =>
      file.url.startsWith(`data:${file.mediaType};base64,`) &&
      (file.url.length - file.url.indexOf(",") - 1) % 4 === 0 &&
      inlineAttachmentBytes(file.url) <= attachmentLimits.bytes
  ) satisfies z.ZodType<FileUIPart>;

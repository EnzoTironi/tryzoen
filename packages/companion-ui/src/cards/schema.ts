import { z } from "zod";
export const linkPreviewInputSchema = z.object({
  url: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        (!url.port || url.port === "443")
      );
    }),
});
export const linkPreviewSchema = z.object({
  title: z.string().max(180),
  description: z.string().max(280),
  image: z
    .string()
    .max(700_000)
    .regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/u)
    .optional(),
});

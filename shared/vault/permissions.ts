import { z } from "zod";

/** Public grant metadata only; never includes stored credential values. */
export const credentialPermissionsSchema = z.object({
  mayManage: z.boolean(),
  items: z.array(
    z.object({
      id: z.string(),
      itemId: z.string(),
      label: z.string().nullable(),
      expiresAt: z.string(),
    })
  ),
});

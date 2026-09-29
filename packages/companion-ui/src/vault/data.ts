import type { z } from "zod";
import type {
  vaultCreateItemSchema,
  vaultItemRevisionSchema,
  vaultUpdateItemSchema,
  vaultPageInputSchema,
  vaultPageSchema,
} from "./schema";
export interface VaultData {
  list: (
    input: z.infer<typeof vaultPageInputSchema>,
    signal?: AbortSignal
  ) => Promise<z.infer<typeof vaultPageSchema>>;
  create: (input: z.infer<typeof vaultCreateItemSchema>) => Promise<void>;
  read: (
    item: z.infer<typeof vaultItemRevisionSchema>,
    signal?: AbortSignal
  ) => Promise<z.infer<typeof vaultCreateItemSchema> | null>;
  update: (input: z.infer<typeof vaultUpdateItemSchema>) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

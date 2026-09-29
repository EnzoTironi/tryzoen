import type { z } from "zod";
import type {
  vaultCreateItemSchema,
  vaultPageInputSchema,
  vaultPageSchema,
} from "./schema";
export interface VaultData {
  list: (
    input: z.infer<typeof vaultPageInputSchema>,
    signal?: AbortSignal
  ) => Promise<z.infer<typeof vaultPageSchema>>;
  create: (input: z.infer<typeof vaultCreateItemSchema>) => Promise<void>;
  remove: (id: string) => Promise<boolean>;
}

import { z } from "zod";
import {
  vaultPageSchema,
  vaultCreateItemSchema,
  vaultItemRevisionSchema,
  vaultUpdateItemSchema,
} from "@zoen/companion-ui/vault";
import type { VaultData } from "@zoen/companion-ui";
export function companionVaultData(rpc: {
  query: (
    path: string,
    input?: unknown,
    options?: { signal?: AbortSignal }
  ) => Promise<unknown>;
  mutation: (
    path: string,
    input?: unknown,
    options?: { signal?: AbortSignal }
  ) => Promise<unknown>;
}): VaultData {
  return {
    async list(input, signal) {
      return vaultPageSchema.parse(
        await rpc.query("vault.list", input, { signal })
      );
    },
    async create(input) {
      await rpc.mutation("vault.create", vaultCreateItemSchema.parse(input));
    },
    async read(item, signal) {
      return vaultCreateItemSchema
        .nullable()
        .parse(
          await rpc.mutation(
            "vault.read",
            vaultItemRevisionSchema.parse(item),
            { signal }
          )
        );
    },
    async update(input) {
      return z
        .boolean()
        .parse(
          await rpc.mutation("vault.update", vaultUpdateItemSchema.parse(input))
        );
    },
    async remove(id) {
      return z.boolean().parse(await rpc.mutation("vault.remove", { id }));
    },
  };
}

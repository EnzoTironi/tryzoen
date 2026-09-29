import { z } from "zod";
import { transaction } from "@db/queries";
import {
  readVaultPage,
  readVaultItemContent,
  updateVaultItem,
  saveVaultItem,
  deleteVaultItem,
} from "@db/services/vault";
import { vaultPageInputSchema } from "@zoen/companion-ui/vault";
import {
  vaultCreateItemSchema,
  vaultItemRevisionSchema,
  vaultUpdateItemSchema,
  vaultImportItemsSchema,
} from "@zoen/companion-ui/vault";
import { resolveWorkspaceActor } from "../session";
import { requireWorkspaceAccess } from "../access";

/** Authorization locks live through the same transaction as the encrypted records. */
export async function listAccountVaultItems(
  headers: Headers,
  raw: z.infer<typeof vaultPageInputSchema>
) {
  const input = vaultPageInputSchema.parse(raw);
  return transaction(async () => {
    const actor = await resolveWorkspaceActor(headers);
    return {
      ...(await readVaultPage(actor, input)),
      mayManage: actor.role !== "member",
    };
  });
}
export async function createAccountVaultItem(
  headers: Headers,
  raw: z.infer<typeof vaultCreateItemSchema>
) {
  const input = vaultCreateItemSchema.parse(raw);
  return transaction(async () => {
    const actor = await requireWorkspaceAccess(
      await resolveWorkspaceActor(headers),
      true
    );
    await saveVaultItem(actor, input);
  });
}
export async function importAccountVaultItems(
  headers: Headers,
  raw: z.infer<typeof vaultImportItemsSchema>
) {
  const input = vaultImportItemsSchema.parse(raw);
  return transaction(async () => {
    const actor = await requireWorkspaceAccess(
      await resolveWorkspaceActor(headers),
      true
    );
    for (const item of input) await saveVaultItem(actor, item);
  });
}
export async function removeAccountVaultItem(headers: Headers, raw: string) {
  const id = z.string().min(1).max(160).parse(raw);
  return transaction(async () => {
    const actor = await requireWorkspaceAccess(
      await resolveWorkspaceActor(headers),
      true
    );
    return deleteVaultItem(actor, id);
  });
}

/** Explicit authenticated reads only; never expose this through list or agent tools. */
export async function readAccountVaultItem(
  headers: Headers,
  raw: z.infer<typeof vaultItemRevisionSchema>
) {
  const input = vaultItemRevisionSchema.parse(raw);
  return transaction(async () => {
    const actor = await requireWorkspaceAccess(
      await resolveWorkspaceActor(headers),
      true
    );
    return readVaultItemContent(actor, input);
  });
}

export async function updateAccountVaultItem(
  headers: Headers,
  raw: z.infer<typeof vaultUpdateItemSchema>
) {
  const input = vaultUpdateItemSchema.parse(raw);
  return transaction(async () => {
    const actor = await requireWorkspaceAccess(
      await resolveWorkspaceActor(headers),
      true
    );
    return updateVaultItem(actor, input);
  });
}

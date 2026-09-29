"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import { VaultItemForm } from "@zoen/companion-ui";
import { companionVaultData } from "@shared/companion/vault";
import { api } from "@web/trpc/client";
import { authClient } from "@web/auth/client";
export function CardForm({
  initialLabel = "",
  onSaved,
}: {
  readonly initialLabel?: string;
  readonly onSaved: () => void;
}) {
  const router = useRouter();
  const client = api.useUtils().client;
  const session = authClient.useSession();
  const data = useMemo(
    () => companionVaultData(getUntypedClient(client)),
    [client]
  );
  return (
    <VaultItemForm
      key={session.data?.session.id ?? "signed-out"}
      onSave={data.create}
      kind="payment"
      initialLabel={initialLabel}
      onDone={() => {
        router.refresh();
        onSaved();
      }}
    />
  );
}

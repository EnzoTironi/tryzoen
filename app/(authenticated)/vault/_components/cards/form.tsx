"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import { VaultCreationForm } from "@zoen/companion-ui";
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
    <VaultCreationForm
      key={session.data?.session.id ?? "signed-out"}
      data={data}
      kind="payment"
      initialLabel={initialLabel}
      onDone={() => {
        router.refresh();
        onSaved();
      }}
    />
  );
}

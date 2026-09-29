"use client";
import { VaultCollection } from "@zoen/companion-ui";
import { companionVaultData } from "@shared/companion/vault";
import { useMemo } from "react";
import { getUntypedClient } from "@trpc/client";
import { useSearchParams } from "next/navigation";
import { api } from "@web/trpc/client";
import { authClient } from "@web/auth/client";
import { VaultDelegation } from "@app/(authenticated)/vault/_components/delegation";
export function SettingsVault({
  wallet = false,
}: {
  readonly wallet?: boolean;
}) {
  const rpc = api.useUtils().client;
  const session = authClient.useSession();
  const data = useMemo(() => companionVaultData(getUntypedClient(rpc)), [rpc]);
  const workspace = useSearchParams().get("space") ?? "personal";
  if (!session.data) return null;
  const scope = `${session.data.user.id}:${session.data.session.id}:${workspace}`;
  return (
    <VaultCollection
      key={scope}
      kind={wallet ? "payment" : "login"}
      data={data}
      cacheScope={scope}
      renderPermission={(id) => <VaultDelegation itemId={id} />}
    />
  );
}

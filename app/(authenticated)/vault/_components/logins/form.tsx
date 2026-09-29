"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import { VaultItemForm } from "@zoen/companion-ui";
import { companionVaultData } from "@shared/companion/vault";
import { api } from "@web/trpc/client";
import { authClient } from "@web/auth/client";
export function LoginForm({
  initialLabel = "",
  onSaved,
  initialOrigin = "",
  initialIdentifierType,
}: {
  readonly initialLabel?: string;
  readonly onSaved: () => void;
  readonly initialOrigin?: string;
  readonly initialIdentifierType?: "email" | "phone" | "username";
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
      kind="login"
      initialLabel={initialLabel}
      initialOrigin={initialOrigin}
      initialIdentifierType={initialIdentifierType}
      onDone={() => {
        router.refresh();
        onSaved();
      }}
    />
  );
}

import { VaultCollection } from "@zoen/companion-ui";
import { companionVaultData } from "../../../../shared/companion/vault";
import { rpc } from "../api";
import { auth } from "../auth";
import { Text } from "react-native";
const data = companionVaultData(rpc);
export function MobileVault({ kind }: { readonly kind: "login" | "payment" }) {
  const session = auth.useSession();
  if (session.isPending) return <Text>Loading your account…</Text>;
  if (session.error || !session.data)
    return (
      <Text accessibilityRole="alert">Sign in to review saved items.</Text>
    );
  const scope = `${session.data.user.id}:${session.data.session.id}`;
  return (
    <VaultCollection key={scope} data={data} kind={kind} cacheScope={scope} />
  );
}

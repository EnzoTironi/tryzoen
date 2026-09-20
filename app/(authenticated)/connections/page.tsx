import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { UsersRoundIcon } from "lucide-react";
import { PanelLink } from "../_components/panel-link";
import { requireRequestScope } from "@web/auth/request-scope";
import { cn } from "@web/components/class-names";
import { getI18n } from "@web/i18n/server";
import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import { readPersonalGoogleSettings } from "../../../server/google-workspace/settings";
import { resolveWorkspaceActor } from "../../../server/workspaces/session";
import {
  AccountControlError,
  readLinkedChannelIdentities,
} from "../../../server/accounts/controls";
import { Alert, AlertTitle, AlertDescription } from "@web/components/ui/alert";
import { ConnectionList } from "./_components/connection-list";
import styles from "../_components/panel.module.css";
import connections from "../_components/connections.module.css";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { TeamConnections } from "./_components/team-connections";
import { ModelConnections } from "../_components/model-connections";
import { ServiceConnections } from "./_components/service-connections";

export default async function ConnectionsPage({
  searchParams,
}: PageProps<"/connections">) {
  const { t } = await getI18n();
  const params = await searchParams;
  const returnTo = googleWorkspaceReturnTo(params.returnTo);
  const scope = await requireRequestScope();
  if (scope.workspaceId !== accessScopeForUser(scope.userId).workspaceId)
    return (
      <div className={styles.page}>
        <h1 className="type-page-title">{t("Conexões da equipe")}</h1>
        <PanelLink className={connections.row} href="/network">
          <UsersRoundIcon />
          {t("Rede da empresa")}
        </PanelLink>
        <TeamConnections />
        <ModelConnections />
        <ServiceConnections />
      </div>
    );
  const requestHeaders = await headers();
  const [google, messengers] = await Promise.all([
    Promise.try(async () => {
      return await Promise.try(async () =>
        resolveWorkspaceActor(requestHeaders)
      ).then(readPersonalGoogleSettings);
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    ),
    Promise.try(async () => readLinkedChannelIdentities(requestHeaders)).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    ),
  ]);
  if (
    !messengers.ok &&
    messengers.error instanceof AccountControlError &&
    messengers.error.reason === "unauthenticated"
  )
    redirect("/sign-in?callbackUrl=%2Fconnections");
  return (
    <div className={styles.page}>
      <h1 className={cn("type-page-title", connections.heading)}>
        {t("Conexões")}
      </h1>
      <PanelLink className={connections.row} href="/network">
        <UsersRoundIcon />
        {t("Minha rede")}
      </PanelLink>
      {!google.ok || !messengers.ok ? (
        <Alert variant="destructive">
          <AlertTitle>
            {t("Não foi possível carregar suas conexões")}
          </AlertTitle>
          <AlertDescription>
            {t("Atualize a página para tentar novamente.")}
          </AlertDescription>
        </Alert>
      ) : (
        <ConnectionList
          googleState={google.value.state}
          identities={messengers.value}
          returnTo={returnTo}
        />
      )}
      {returnTo !== "/" && (
        <Link className={styles.subtleLink} href={returnTo}>
          {t("Voltar para a conversa")}
        </Link>
      )}
      <ModelConnections />
      <ServiceConnections />
    </div>
  );
}

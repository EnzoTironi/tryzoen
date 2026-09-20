import { getI18n } from "@web/i18n/server";
import { PanelLink } from "../_components/panel-link";

import { headers } from "next/headers";
import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import { requireRequestScope } from "@web/auth/request-scope";
import { FirstRunStatus } from "./_components/first-run-status";
import { readLinkedChannelIdentities } from "../../../server/accounts/controls";
import styles from "../_components/home.module.css";

export default async function Page({ searchParams }: PageProps<"/">) {
  const { t } = await getI18n();
  const params = await searchParams;
  const returnTo = googleWorkspaceReturnTo(params.returnTo);
  await requireRequestScope();
  const welcome = params.welcome === "1" || params.welcome === "true";
  const linkedChannels = welcome
    ? await Promise.try(async () =>
        readLinkedChannelIdentities(await headers())
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    : undefined;
  return (
    <>
      {linkedChannels && !linkedChannels.ok && (
        <p className={styles.notice} role="alert">
          {t("Não foi possível verificar seus mensageiros.")}{" "}
          <PanelLink href="/connections">{t("Revisar conexões")}</PanelLink>.
        </p>
      )}
      {params.google === "unavailable" && (
        <p className={styles.notice} role="alert">
          {t("Não foi possível atualizar a conexão com o Google.")}{" "}
          <PanelLink href="/connections">{t("Revisar conexão")}</PanelLink>.
        </p>
      )}
      {returnTo !== "/" && (
        <p className={styles.notice}>
          <PanelLink href={returnTo}>{t("Voltar para sua conversa")}</PanelLink>{" "}
          {t("ou")}{" "}
          <PanelLink
            href={`/connections?returnTo=${encodeURIComponent(returnTo)}`}
          >
            {t("gerenciar a conexão com o Google")}
          </PanelLink>
          .
        </p>
      )}
      {linkedChannels && linkedChannels.ok && (
        <div className={styles.notice}>
          <FirstRunStatus identities={linkedChannels.value} welcome />
        </div>
      )}
    </>
  );
}

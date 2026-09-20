import { getI18n } from "@web/i18n/server";
import { headers } from "next/headers";

import { CheckIcon } from "lucide-react";
import { requireRequestScope } from "@web/auth/request-scope";
import { Button } from "@web/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@web/components/ui/alert";
import { readPersonalGoogleSettings } from "../../../server/google-workspace/settings";
import { resolveWorkspaceActor } from "../../../server/workspaces/session";
import { PanelIntro } from "../_components/panel-intro";
import styles from "../_components/panel.module.css";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { PanelLink } from "../_components/panel-link";

export default async function MailPage() {
  const { t } = await getI18n();
  const scope = await requireRequestScope();
  if (scope.workspaceId !== accessScopeForUser(scope.userId).workspaceId)
    return (
      <div className={styles.page}>
        <PanelIntro
          image="/marketing/panel/zoen-mail.jpg"
          title={t("Cada coisa no seu espaço.")}
          description={t(
            "Seu Gmail pessoal continua no espaço pessoal. Você pode preparar textos com os arquivos da equipe."
          )}
        />
        <div className={styles.actions}>
          <Button nativeButton={false} render={<PanelLink href="/chat" />}>
            {t("Abrir conversa")}
          </Button>
        </div>
      </div>
    );
  const connection = await Promise.try(async () => {
    return await Promise.try(async () =>
      resolveWorkspaceActor(await headers())
    ).then(readPersonalGoogleSettings);
  }).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  const connected = connection.ok && connection.value.state === "connected";
  return (
    <div className={styles.page}>
      <PanelIntro
        image="/marketing/panel/zoen-mail.jpg"
        title={t("Menos e-mail. Mais vida.")}
        description={t("Resumos e respostas, em uma conversa.")}
      />
      {!connection.ok ? (
        <Alert variant="destructive">
          <AlertTitle>{t("Não foi possível verificar seu Gmail")}</AlertTitle>
          <AlertDescription>
            {t("Tente novamente em")}{" "}
            <PanelLink href="/connections" className="underline">
              {t("Conexões")}
            </PanelLink>
            .
          </AlertDescription>
        </Alert>
      ) : (
        <div className={styles.actions}>
          <Button
            nativeButton={false}
            render={
              <PanelLink
                href={connected ? "/chat?starter=email" : "/connections"}
              />
            }
          >
            {connected ? t("Organizar meus e-mails") : t("Conectar meu Gmail")}
          </Button>
          {connected && (
            <>
              <PanelLink
                href="/chat?starter=email-draft"
                className={styles.subtleLink}
              >
                {t("Preparar uma resposta")}
              </PanelLink>
              <PanelLink href="/connections" className={styles.statusLine}>
                <CheckIcon aria-hidden="true" />
                {t("Gmail conectado")}
              </PanelLink>
            </>
          )}
        </div>
      )}
    </div>
  );
}

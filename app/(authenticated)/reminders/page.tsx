import { getI18n } from "@web/i18n/server";
import { PlusIcon } from "lucide-react";
import styles from "../_components/panel.module.css";

import { PanelLink } from "../_components/panel-link";
import { ReminderList } from "./reminder-list";
import { listReminders } from "../../../server/schedules/queries";
import { requireRequestScope } from "@web/auth/request-scope";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";

export default async function RemindersPage() {
  const { t } = await getI18n();
  const scope = await requireRequestScope();
  const result = await Promise.try(async () => listReminders(scope)).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  return (
    <div className={styles.page}>
      {(!result.ok || result.value.reminders.length > 0) && (
        <header className={styles.pageHeader}>
          <div>
            <h1 className="type-page-title">{t("Já está combinado.")}</h1>
            <p className={styles.intro}>
              {t("Ajuste cada pedido na conversa em que ele começou.")}
            </p>
          </div>
          <Button
            nativeButton={false}
            render={<PanelLink href="/chat?starter=reminder" />}
            variant="outline"
          >
            <PlusIcon aria-hidden="true" /> {t("Criar automação")}
          </Button>
        </header>
      )}
      {!result.ok ? (
        <Alert variant="destructive">
          <AlertTitle>
            {t("Não foi possível carregar as automações")}
          </AlertTitle>
          <AlertDescription>
            {t(
              "Atualize a página para tentar novamente. Seus agendamentos foram preservados."
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <ReminderList {...result.value} />
      )}
    </div>
  );
}

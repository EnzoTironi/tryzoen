import Link from "next/link";
import { getI18n } from "@web/i18n/server";
import { Button } from "@web/components/ui/button";
import { StatusPage } from "./_components/status-page";

export default async function WorkspaceNotFound() {
  const { t } = await getI18n();
  return (
    <StatusPage
      code="404"
      title={t("Este espaço não está disponível.")}
      description={t(
        "O acesso pode ter mudado. Seu espaço pessoal continua aqui."
      )}
    >
      <Button
        size="lg"
        className="rounded-full px-5"
        nativeButton={false}
        render={<Link href="/" />}
      >
        {t("Voltar ao meu espaço")}
      </Button>
    </StatusPage>
  );
}

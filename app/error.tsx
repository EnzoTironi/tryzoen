"use client";

import { useI18n } from "@zoen/companion-ui/i18n";
import { Button } from "@web/components/ui/button";
import { StatusPage } from "./_components/status-page";

export default function ApplicationError({
  reset,
}: {
  readonly reset: () => void;
}) {
  const { t } = useI18n();
  return (
    <StatusPage
      code={t("Error")}
      title={t("Page unavailable")}
      description={t("This page could not be loaded.")}
    >
      <Button
        size="lg"
        className="rounded-full px-5"
        type="button"
        onClick={reset}
      >
        {t("Try again")}
      </Button>
    </StatusPage>
  );
}

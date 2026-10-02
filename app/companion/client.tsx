"use client";

import { useI18n } from "@zoen/companion-ui/i18n";
import dynamic from "next/dynamic";

const ConnectedCompanion = dynamic(
  () => import("./connected").then((module) => module.ConnectedCompanion),
  {
    ssr: false,
    loading: CompanionLoading,
  }
);

export function CompanionClient(props: {
  readonly sessionId?: string;
  readonly title?: string;
  readonly draftScope: string;
}) {
  return <ConnectedCompanion {...props} />;
}

function CompanionLoading() {
  const { t } = useI18n();
  return <output style={{ padding: 32 }}>{t("Opening Zoen…")}</output>;
}

import { getI18n } from "@web/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WEEKEND_IMESSAGE_URL } from "../../server/channels/destination";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("Começar uma conversa | Zoen"),
    description: t("Abra seu mensageiro e faça o primeiro pedido ao Zoen."),
    robots: { index: false },
  };
}

export default function GetStartedPage() {
  redirect(WEEKEND_IMESSAGE_URL);
}

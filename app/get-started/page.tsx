import { getI18n } from "@web/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingShell } from "@web/auth/onboarding/shell";
import { weekendPublicDestinations } from "../../server/channels/destination";
import { GetStartedPanel } from "./_components/get-started-panel";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("Começar uma conversa | Zoen"),
    description: t("Abra seu mensageiro e faça o primeiro pedido ao Zoen."),
    robots: { index: false },
  };
}

export default function GetStartedPage() {
  const destinations = weekendPublicDestinations;
  if (destinations.imessage) redirect(destinations.imessage);
  return (
    <OnboardingShell>
      <GetStartedPanel
        whatsappUrl={destinations.whatsapp}
        telegramUrl={destinations.telegram}
        imessageUrl={destinations.imessage}
      />
    </OnboardingShell>
  );
}

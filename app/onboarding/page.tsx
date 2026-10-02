import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthSession } from "@db/services/auth/session";
import { safeCallbackUrl } from "@web/auth/channel/client";
import { OnboardingShell } from "@web/auth/onboarding/shell";
import { OnboardingSetup } from "@web/auth/onboarding/setup";
import { getI18n } from "@web/i18n/server";
import { TRPCProvider } from "@web/trpc/client";
import { conversationDestinations } from "../../server/channels/destination";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("Seu Zoen"), robots: { index: false } };
}

export default async function OnboardingPage({
  searchParams,
}: PageProps<"/onboarding">) {
  const requestHeaders = await headers();
  if (!(await getAuthSession(requestHeaders)))
    redirect("/sign-in?callbackUrl=%2Fonboarding");
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(
    Array.isArray(params.callbackUrl)
      ? params.callbackUrl[0]
      : params.callbackUrl
  );
  const destinations = conversationDestinations();
  return (
    <OnboardingShell>
      <TRPCProvider>
        <OnboardingSetup
          initialStep={
            params.step === "connections" ? "connections" : "companion"
          }
          callbackUrl={callbackUrl}
          available={[
            ...(destinations.telegram ? ["telegram" as const] : []),
            ...(destinations.whatsapp ? ["kapso" as const] : []),
          ]}
        />
      </TRPCProvider>
    </OnboardingShell>
  );
}

import { env } from "@shared/environment/env";
import { weekendPublicDestinations } from "../../server/channels/destination";
import { MarketingAnalytics } from "./_components/analytics";
import { OnboardingProvider } from "./_components/onboarding";

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <OnboardingProvider destinations={weekendPublicDestinations}>
      <MarketingAnalytics
        apiHost={env.NEXT_PUBLIC_POSTHOG_HOST}
        projectToken={env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN}
      />
      {children}
    </OnboardingProvider>
  );
}

import { weekendPublicDestinations } from "../../server/channels/destination";
import { OnboardingProvider } from "./_components/onboarding";

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <OnboardingProvider destinations={weekendPublicDestinations}>
      {children}
    </OnboardingProvider>
  );
}

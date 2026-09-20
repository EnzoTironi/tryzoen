import type { Metadata } from "next";
import {
  companionCanonicalPath,
  companionPublicOrigin,
} from "../public-origin";
import {
  zoenSocialDescription,
  zoenSocialMetadata,
  zoenSocialTitle,
} from "../social";
import { MarketingLanding } from "./_components/marketing-landing";

const canonical = companionCanonicalPath("/");

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(companionPublicOrigin),
    title: zoenSocialTitle,
    description: zoenSocialDescription,
    alternates: { canonical },
    ...zoenSocialMetadata({ path: "/" }),
  };
}

export default function WelcomePage() {
  return <MarketingLanding />;
}

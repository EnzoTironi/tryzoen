import type { Metadata } from "next";
import { getI18n } from "@web/i18n/server";
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
  const { t } = await getI18n();
  const title = t(zoenSocialTitle);
  const description = t(zoenSocialDescription);
  return {
    metadataBase: new URL(companionPublicOrigin),
    title,
    description,
    alternates: { canonical },
    ...zoenSocialMetadata({ title, description, path: "/" }),
  };
}

export default function WelcomePage() {
  return <MarketingLanding />;
}

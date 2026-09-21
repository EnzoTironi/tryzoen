"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

let posthogReady = false;

export function MarketingAnalytics({
  apiHost = "https://us.i.posthog.com",
  projectToken,
}: {
  readonly apiHost?: string;
  readonly projectToken?: string;
}) {
  const pathname = usePathname();
  useEffect(() => {
    if (!projectToken) return undefined;
    let cancelled = false;
    void import("posthog-js").then(({ default: posthog }) => {
      if (cancelled) return;
      if (!posthogReady) {
        posthog.init(projectToken, {
          api_host: apiHost,
          autocapture: true,
          capture_pageview: false,
          person_profiles: "identified_only",
        });
        posthogReady = true;
      }
      posthog.capture("$pageview", {
        $current_url: window.location.href,
        pathname,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [apiHost, pathname, projectToken]);
  return null;
}

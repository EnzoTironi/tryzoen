import type { Metadata } from "next";
import { companionCanonicalPath, companionPublicOrigin } from "./public-origin";

/** Product voice for X/Twitter, iMessage, and other link previews. */
export const zoenSocialTitle = "Life happens. Text Zoen.";
export const zoenSocialDescription =
  "iMessage + SMS. One little monster who builds software. Free. No credit card. Just text.";

/** Query busts stale X/iMessage image caches without renaming the file. */
export const zoenSocialImageUrl = `${companionPublicOrigin}/marketing/zoen-running.jpg?v=20260920`;

const zoenSocialImage = {
  url: zoenSocialImageUrl,
  type: "image/jpeg",
  width: 1792,
  height: 1008,
  alt: "Zoen",
} as const;

/**
 * Open Graph + Twitter Card fields for crawlers (X, iMessage, chat apps).
 * Image URLs stay absolute on the production host so preview fetchers
 * do not depend on the request origin or `metadataBase`.
 */
export function zoenSocialMetadata({
  title = zoenSocialTitle,
  description = zoenSocialDescription,
  path,
}: {
  title?: string;
  description?: string;
  path?: `/${string}`;
} = {}): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      title,
      description,
      ...(path ? { url: companionCanonicalPath(path) } : {}),
      type: "website",
      siteName: "Zoen",
      images: [zoenSocialImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      site: "@tryZoen",
      images: [zoenSocialImage],
    },
  };
}

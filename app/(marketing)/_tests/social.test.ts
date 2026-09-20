import { describe, expect, it } from "vitest";
import {
  zoenSocialDescription,
  zoenSocialImageUrl,
  zoenSocialMetadata,
  zoenSocialTitle,
} from "../social";

describe("marketing social metadata", () => {
  it("uses an absolute HTTPS image and a large Twitter card", () => {
    const metadata = zoenSocialMetadata({ path: "/welcome" });

    expect(zoenSocialImageUrl).toBe(
      "https://zoen.tironi.xyz/marketing/zoen-running.jpg"
    );
    expect(metadata.openGraph).toMatchObject({
      title: zoenSocialTitle,
      description: zoenSocialDescription,
      url: "https://zoen.tironi.xyz/welcome",
      type: "website",
      siteName: "Zoen",
      images: [
        {
          url: zoenSocialImageUrl,
          type: "image/jpeg",
          width: 1792,
          height: 1008,
          alt: "Zoen",
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: zoenSocialTitle,
      description: zoenSocialDescription,
      site: "@tryZoen",
      images: [
        {
          url: zoenSocialImageUrl,
          type: "image/jpeg",
          width: 1792,
          height: 1008,
          alt: "Zoen",
        },
      ],
    });
  });

  it("keeps page-specific copy when a landing route overrides it", () => {
    const metadata = zoenSocialMetadata({
      title: "Guia — primeiros passos | Zoen",
      description: "Como começar no Zoen.",
      path: "/docs",
    });

    expect(metadata.openGraph).toMatchObject({
      title: "Guia — primeiros passos | Zoen",
      description: "Como começar no Zoen.",
      url: "https://zoen.tironi.xyz/docs",
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Guia — primeiros passos | Zoen",
    });
  });
});

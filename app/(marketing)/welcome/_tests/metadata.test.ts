import { describe, expect, it } from "vitest";
import {
  zoenSocialDescription,
  zoenSocialImageUrl,
  zoenSocialTitle,
} from "../../social";
import { generateMetadata } from "../page";

describe("welcome generateMetadata", () => {
  it("uses the English social card for the document and crawler tags", async () => {
    const metadata = await generateMetadata();

    expect(metadata.title).toBe(zoenSocialTitle);
    expect(metadata.description).toBe(zoenSocialDescription);
    expect(metadata.description).not.toMatch(/WhatsApp|Telegram|100 bucks|—/);
    expect(metadata.alternates).toEqual({
      canonical: "https://tryzoen.com/",
    });
    expect(metadata.openGraph).toMatchObject({
      title: zoenSocialTitle,
      description: zoenSocialDescription,
      url: "https://tryzoen.com/",
      type: "website",
      siteName: "Zoen",
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: zoenSocialTitle,
      description: zoenSocialDescription,
      site: "@tryZoen",
    });
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: zoenSocialImageUrl }),
    ]);
    expect(metadata.twitter?.images).toEqual([
      expect.objectContaining({ url: zoenSocialImageUrl }),
    ]);
  });
});

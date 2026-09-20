import { describe, expect, it, vi } from "vitest";
import {
  zoenSocialDescription,
  zoenSocialImageUrl,
  zoenSocialTitle,
} from "../../social";

vi.mock("@web/i18n/server", () => ({
  getI18n: async () => ({
    locale: "pt-BR",
    messages: {},
    t: (key: string) => key,
  }),
}));

const { generateMetadata } = await import("../page");

describe("welcome generateMetadata", () => {
  it("keeps the localized document title and emits the product social card", async () => {
    const metadata = await generateMetadata();

    expect(metadata.title).toBe("Zoen — sua vida tem companhia");
    expect(metadata.alternates).toEqual({
      canonical: "https://zoen.tironi.xyz/welcome",
    });
    expect(metadata.openGraph).toMatchObject({
      title: zoenSocialTitle,
      description: zoenSocialDescription,
      url: "https://zoen.tironi.xyz/welcome",
      type: "website",
      siteName: "Zoen",
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: zoenSocialTitle,
      site: "@tryZoen",
    });
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: zoenSocialImageUrl }),
    ]);
  });
});

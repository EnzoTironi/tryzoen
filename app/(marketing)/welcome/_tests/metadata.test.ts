import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  zoenSocialDescription,
  zoenSocialImageUrl,
  zoenSocialTitle,
} from "../../social";
import { generateMetadata } from "../page";

const request = vi.hoisted(() => ({ locale: "en" as "en" | "es" | "pt-BR" }));
vi.mock("@web/i18n/server", async () => {
  const { catalogs, createTranslator } =
    await import("@zoen/companion-ui/i18n");
  return {
    getI18n: async () => ({
      locale: request.locale,
      t: createTranslator(catalogs[request.locale], request.locale),
    }),
  };
});
beforeEach(() => {
  request.locale = "en";
});

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

it.each([
  ["es", "La vida sigue. Escribe a Zoen."],
  ["pt-BR", "A vida acontece. Mande uma mensagem para o Zoen."],
] as const)(
  "localizes the browser title and link preview in %s",
  async (locale, title) => {
    request.locale = locale;
    const metadata = await generateMetadata();
    expect(metadata.title).toBe(title);
    expect(metadata.openGraph).toMatchObject({
      title,
      description: metadata.description,
    });
    expect(metadata.twitter).toMatchObject({
      title,
      description: metadata.description,
    });
  }
);

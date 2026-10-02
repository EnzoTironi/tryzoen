import { catalogs } from "@zoen/companion-ui/i18n";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveLocale } from "@zoen/companion-ui/i18n";
import {
  createTranslator,
  createErrorTranslator,
} from "@zoen/companion-ui/i18n";
import { validationOptions } from "./validation";
import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { useI18n } from "@zoen/companion-ui/i18n";

const { en, es, "pt-BR": ptBR } = catalogs;

describe("locale selection", () => {
  it("keeps the saved preference ahead of the browser language", () => {
    expect(resolveLocale("es", "pt-BR,en;q=0.8")).toBe("es");
    expect(resolveLocale("en", "es")).toBe("en");
  });
  it("negotiates supported languages by quality and ignores excluded languages", () => {
    expect(resolveLocale(undefined, "fr,es-MX;q=0.9,en-US;q=0.8")).toBe("es");
    expect(resolveLocale(undefined, "en;q=0,pt-PT;q=0.5")).toBe("pt-BR");
    expect(resolveLocale("invalid", "es;q=0.3,en;q=0.9")).toBe("en");
    expect(resolveLocale(undefined, "fr;q=bogus")).toBe("pt-BR");
  });
});

describe("translated UI", () => {
  it("has the same messages and interpolation values in every catalog", () => {
    for (const catalog of [en, es]) {
      expect(Object.keys(catalog).toSorted()).toEqual(
        Object.keys(ptBR).toSorted()
      );
      const translations: Readonly<Record<string, string | undefined>> =
        catalog;
      for (const [key, value] of Object.entries(ptBR)) {
        const translated = translations[key];
        expect(translated).toBeTruthy();
        expect(translated?.match(/\{\w+\}/g)?.toSorted()).toEqual(
          value.match(/\{\w+\}/g)?.toSorted()
        );
      }
    }
  });
  it("interpolates user values without translating or interpreting their contents", () => {
    expect(renderToStaticMarkup(<Message />, "en")).toBe(
      "<p>Open &lt;script&gt;$&amp;{name}&lt;/script&gt;</p>"
    );
    expect(createTranslator(es)("Telegram")).toBe("Telegram");
  });
  it("selects grammatical plurals for counts in each language", () => {
    expect(
      createTranslator(en, "en")("Every {count} minutes", { count: 1 })
    ).toBe("Every 1 minute");
    expect(
      createTranslator(en, "en")("Every {count} minutes", { count: 2 })
    ).toBe("Every 2 minutes");
    expect(
      createTranslator(es, "es")("Every {count} minutes", { count: 1 })
    ).toBe("Cada 1 minuto");
    expect(
      createTranslator(es, "es")("Every {count} minutes", { count: 0 })
    ).toBe("Cada 0 minutos");
    expect(
      createTranslator(ptBR, "pt-BR")("Every {count} minutes", { count: 1 })
    ).toBe("A cada 1 minuto");
    expect(
      createTranslator(ptBR, "pt-BR")("Every {count} minutes", { count: 5 })
    ).toBe("A cada 5 minutos");
  });
  it("shows translated action failures without exposing unknown provider details", () => {
    const spanish = createErrorTranslator(es);
    expect(spanish(ptBR["Unable to open your browser."])).toBe(
      es["Unable to open your browser."]
    );
    expect(spanish(new Error("Unable to open your browser."))).toBe(
      "No se pudo abrir tu navegador."
    );
    expect(
      spanish(new Error("Provider failure: private endpoint and credentials"))
    ).toBe("No se pudo completar esta acción. Inténtalo de nuevo.");
    expect(spanish(new Error("No se pudo abrir tu navegador."))).toBe(
      "No se pudo abrir tu navegador."
    );
    expect(
      createErrorTranslator(en)(new Error("Unable to open your browser."))
    ).toBe("Unable to open your browser.");
  });
  it("localizes validation per parse without changing another request's language", () => {
    const schema = z.string().min(3);
    const english = schema.safeParse("", validationOptions("en"));
    const spanish = schema.safeParse("", validationOptions("es"));
    const portuguese = schema.safeParse("", validationOptions("pt-BR"));
    expect(english.error?.issues[0]?.message).toContain("Too small");
    expect(spanish.error?.issues[0]?.message).not.toEqual(
      english.error?.issues[0]?.message
    );
    expect(portuguese.error?.issues[0]?.message).not.toEqual(
      spanish.error?.issues[0]?.message
    );
    expect(schema.safeParse("", validationOptions("en")).error?.issues).toEqual(
      english.error?.issues
    );
  });
});

function Message() {
  const { t } = useI18n();
  return <p>{t("Abrir {name}", { name: "<script>$&{name}</script>" })}</p>;
}

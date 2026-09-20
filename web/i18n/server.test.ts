import { expect, it, vi } from "vitest";
import { getI18n } from "./server";

vi.unmock("@web/i18n/server");
const request = vi.hoisted(() => ({ preference: "", language: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "zoen-locale" && request.preference
        ? { value: request.preference }
        : undefined,
  }),
  headers: async () => new Headers({ "accept-language": request.language }),
}));

it.each([
  ["en-US,en;q=0.9,pt-BR;q=0.8", "en"],
  ["es-MX,es;q=0.9,en;q=0.8", "es"],
  ["pt-PT,pt;q=0.9", "pt-BR"],
  ["fr-FR,fr;q=0.9", "pt-BR"],
])(
  "detects the first visit's browser language (%s)",
  async (language, locale) => {
    request.preference = "";
    request.language = language;
    expect((await getI18n()).locale).toBe(locale);
  }
);

it("keeps a manual choice when a later request has a different browser language", async () => {
  request.preference = "es";
  request.language = "en-US,en;q=0.9";
  const first = await getI18n();
  request.language = "pt-BR,pt;q=0.9";
  const later = await getI18n();
  expect(first.locale).toBe("es");
  expect(later.locale).toBe("es");
  expect(later.t("Entrar")).toBe("Entrar");
});

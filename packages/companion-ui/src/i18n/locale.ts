import { z } from "zod";

export const localeSchema = z.enum(["pt-BR", "en", "es"]);
export type Locale = z.output<typeof localeSchema>;
export const localeCookie = "zoen-locale";

export const localeNames = {
  "pt-BR": "Português (Brasil)",
  en: "English",
  es: "Español",
} as const;

export function resolveLocale(
  preference?: string,
  acceptLanguage?: string | null
): Locale {
  const saved = localeSchema.safeParse(preference);
  if (saved.success) return saved.data;
  const languages = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) =>
        parameter.trim().startsWith("q=")
      );
      return {
        tag: tag?.toLowerCase().split("-")[0],
        quality: quality ? Number(quality.trim().slice(2)) : 1,
      };
    })
    .filter(({ quality }) => quality > 0 && quality <= 1);
  let best: { locale: Locale; quality: number } | undefined;
  for (const { tag, quality } of languages) {
    const locale =
      tag === "pt" ? "pt-BR" : tag === "en" || tag === "es" ? tag : undefined;
    if (locale && (!best || quality > best.quality)) best = { locale, quality };
  }
  return best?.locale ?? "pt-BR";
}

import type { Locale } from "../i18n/locale";

/** Load only the chosen CLDR language when the reaction picker is opened. */
export async function loadEmojiLabels(locale: Exclude<Locale, "en">) {
  const { default: entries } =
    locale === "es"
      ? await import("emojibase-data/es/compact.json")
      : await import("emojibase-data/pt/compact.json");
  return new Map(
    entries
      .flatMap((entry) => [entry].concat(entry.skins ?? []))
      .map((entry) => [entry.unicode.replaceAll("\uFE0F", ""), entry.label])
  );
}

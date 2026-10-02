import en from "./messages/en.json" with { type: "json" };
import es from "./messages/es.json" with { type: "json" };
import ptBR from "./messages/pt-br.json" with { type: "json" };
import type messages from "./messages/pt-br.json";
import type { Locale } from "./locale";

const messageKeys = new Map(
  [en, es, ptBR].flatMap((catalog) =>
    Object.entries(catalog).map(([key, value]) => [value, key] as const)
  )
);

type MessageKey = keyof typeof messages;
export type Messages = Record<MessageKey, string>;

export function createTranslator(catalog: Messages, locale: Locale = "en") {
  const translations: Readonly<Record<string, string | undefined>> = catalog;
  const plurals = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale);
  return (key: string, values?: Readonly<Record<string, string | number>>) => {
    const pluralKey =
      typeof values?.count === "number"
        ? `${key}.${plurals.select(values.count)}`
        : key;
    const selected = Object.hasOwn(catalog, pluralKey) ? pluralKey : key;
    const template = Object.hasOwn(catalog, selected)
      ? (translations[selected] ?? key)
      : key;
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      values?.[name] === undefined
        ? placeholder
        : typeof values[name] === "number"
          ? numbers.format(values[name])
          : values[name]
    );
  };
}

export function createErrorTranslator(catalog: Messages) {
  const t = createTranslator(catalog);
  const localized = new Set(Object.values(catalog));
  return (
    cause: unknown,
    fallback = "This action could not be completed. Try again."
  ) => {
    const message =
      typeof cause === "string"
        ? cause
        : cause instanceof Error
          ? cause.message
          : undefined;
    if (message && localized.has(message)) return message;
    const key =
      message &&
      (Object.hasOwn(catalog, message) ? message : messageKeys.get(message));
    return key ? t(key) : t(fallback);
  };
}

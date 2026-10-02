export { Translated } from "./translated";
export { I18nProvider } from "./provider";
export { I18nContext, useI18n } from "./context";
export {
  createTranslator,
  createErrorTranslator,
  type Messages,
} from "./translate";
export {
  localeSchema,
  localeCookie,
  localeNames,
  resolveLocale,
  type Locale,
} from "./locale";
import en from "./messages/en.json";
import es from "./messages/es.json";
import ptBR from "./messages/pt-br.json";
import type { Locale } from "./locale";
import type { Messages } from "./translate";
export const catalogs = { en, es, "pt-BR": ptBR } satisfies Record<
  Locale,
  Messages
>;

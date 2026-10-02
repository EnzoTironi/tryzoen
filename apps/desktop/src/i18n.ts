import { app, type Session } from "electron";
import { localeCookie, resolveLocale } from "@zoen/companion-ui/i18n/locale";
import { createTranslator } from "@zoen/companion-ui/i18n/translate";
import en from "@zoen/companion-ui/i18n/messages/en" with { type: "json" };
import es from "@zoen/companion-ui/i18n/messages/es" with { type: "json" };
import ptBR from "@zoen/companion-ui/i18n/messages/pt-br" with { type: "json" };

const catalogs = { en, es, "pt-BR": ptBR };
export let desktopText = createTranslator(
  catalogs[
    resolveLocale(undefined, new Intl.DateTimeFormat().resolvedOptions().locale)
  ]
);
let languageRevision = 0;

/** The hosted interface's saved language also controls native dialogs and menus. */
export async function refreshDesktopLanguage(session: Session, url: string) {
  const revision = ++languageRevision;
  const preferences = await session.cookies.get({ url, name: localeCookie });
  if (revision !== languageRevision) return;
  const locale = resolveLocale(preferences[0]?.value, app.getLocale());
  desktopText = createTranslator(catalogs[locale], locale);
}

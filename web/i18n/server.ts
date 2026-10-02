import { cache } from "react";
import { cookies, headers } from "next/headers";
import { localeCookie, resolveLocale } from "@zoen/companion-ui/i18n";
import { createTranslator } from "@zoen/companion-ui/i18n";
import { catalogs } from "@zoen/companion-ui/i18n";

export const getI18n = cache(async () => {
  const preference = (await cookies()).get(localeCookie)?.value;
  const locale = resolveLocale(
    preference,
    (await headers()).get("accept-language")
  );
  const messages = catalogs[locale];
  return { locale, messages, t: createTranslator(messages, locale) };
});

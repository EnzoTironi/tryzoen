import * as SecureStore from "expo-secure-store";
import {
  localeSchema,
  resolveLocale,
  type Locale,
} from "@zoen/companion-ui/i18n";

const key = "zoen.locale";

export function deviceLocale() {
  return resolveLocale(
    undefined,
    new Intl.DateTimeFormat().resolvedOptions().locale
  );
}

export async function readLocalePreference() {
  const saved = localeSchema.safeParse(await SecureStore.getItemAsync(key));
  return saved.success ? saved.data : undefined;
}

export async function saveLocalePreference(locale: Locale) {
  await SecureStore.setItemAsync(key, locale);
}

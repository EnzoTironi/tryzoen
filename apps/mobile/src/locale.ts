import {
  localeSchema,
  resolveLocale,
  type Locale,
} from "@zoen/companion-ui/i18n";

const key = "zoen.locale";

export function deviceLocale() {
  return resolveLocale(
    undefined,
    typeof navigator === "undefined"
      ? new Intl.DateTimeFormat().resolvedOptions().locale
      : navigator.languages.join(",")
  );
}

export async function readLocalePreference() {
  const saved = localeSchema.safeParse(localStorage.getItem(key));
  return saved.success ? saved.data : undefined;
}

export async function saveLocalePreference(locale: Locale) {
  localStorage.setItem(key, locale);
}

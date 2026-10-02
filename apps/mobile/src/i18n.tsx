import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ActivityIndicator } from "react-native";
import {
  catalogs,
  createTranslator,
  I18nProvider,
  type Locale,
} from "@zoen/companion-ui/i18n";
import { LanguageOptions } from "@zoen/companion-ui";
import {
  deviceLocale,
  readLocalePreference,
  saveLocalePreference,
} from "./locale";

const LocalePreferenceContext = createContext<
  ((locale: Locale) => Promise<void>) | null
>(null);

export function MobileI18n({ children }: { readonly children: ReactNode }) {
  const [locale, setLocale] = useState(deviceLocale);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void readLocalePreference()
      .then((saved) => {
        if (active && saved) setLocale(saved);
      })
      .catch(() => {
        // Device language remains available when preference storage cannot be read.
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const changeLocale = useCallback(async (next: Locale) => {
    await saveLocalePreference(next);
    setLocale(next);
  }, []);
  return (
    <I18nProvider locale={locale} messages={catalogs[locale]}>
      <LocalePreferenceContext value={changeLocale}>
        {ready ? (
          children
        ) : (
          <ActivityIndicator
            accessibilityLabel={createTranslator(catalogs[locale])(
              "Loading your language…"
            )}
          />
        )}
      </LocalePreferenceContext>
    </I18nProvider>
  );
}

export function MobileLanguagePicker() {
  const changeLocale = useContext(LocalePreferenceContext);
  if (!changeLocale)
    throw new Error("MobileLanguagePicker requires MobileI18n");
  return <LanguageOptions onChange={changeLocale} />;
}

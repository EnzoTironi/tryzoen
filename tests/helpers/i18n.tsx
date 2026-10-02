import { catalogs } from "@zoen/companion-ui/i18n";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { I18nProvider } from "@zoen/companion-ui/i18n";
import type { Locale } from "@zoen/companion-ui/i18n";

const searchParams = new URLSearchParams();

export function renderToStaticMarkup(
  node: ReactNode,
  locale: Locale = "pt-BR"
) {
  return renderMarkup(
    <I18nProvider locale={locale} messages={catalogs[locale]}>
      <SearchParamsContext.Provider value={searchParams}>
        {node}
      </SearchParamsContext.Provider>
    </I18nProvider>
  );
}

export function renderToEnglishMarkup(node: ReactNode) {
  return renderToStaticMarkup(node, "en");
}

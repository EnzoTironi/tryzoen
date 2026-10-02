import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import {
  catalogs,
  I18nProvider,
  type Locale,
  type Messages,
} from "@zoen/companion-ui/i18n";

const sourceMessages: Messages = { ...catalogs.en };
const sourceCatalog: Record<string, string> = sourceMessages;
for (const key of Object.keys(sourceCatalog)) sourceCatalog[key] = key;

/** Keep existing behavior assertions independent of the selected translation. */
export function renderToSourceMarkup(node: ReactNode) {
  return renderMarkup(
    <I18nProvider locale="en" messages={sourceMessages}>
      {node}
    </I18nProvider>
  );
}

export function renderToLocalizedMarkup(node: ReactNode, locale: Locale) {
  return renderMarkup(
    <I18nProvider locale={locale} messages={catalogs[locale]}>
      {node}
    </I18nProvider>
  );
}

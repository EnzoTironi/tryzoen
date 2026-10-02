"use client";

import { useMemo, type ReactNode } from "react";
import type { Locale } from "./locale";
import { I18nContext } from "./context";
import {
  createTranslator,
  createErrorTranslator,
  type Messages,
} from "./translate";

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      locale,
      t: createTranslator(messages, locale),
      errorText: createErrorTranslator(messages),
    }),
    [locale, messages]
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}

"use client";

import { useState, useTransition } from "react";
import { LanguagesIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web/components/ui/select";
import { localeNames } from "./locale";
import { changeLocale } from "./actions";
import { useI18n } from "./context";

export function LanguagePicker({
  compact = false,
}: {
  readonly compact?: boolean;
}) {
  const { locale, t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div className={compact ? "relative flex items-center" : "space-y-2"}>
      <Select
        value={locale}
        disabled={pending}
        onValueChange={(value) => {
          if (!value || value === locale) return;
          setFailed(false);
          startTransition(async () => {
            try {
              await changeLocale(value);
            } catch {
              setFailed(true);
            }
          });
        }}
      >
        <SelectTrigger
          aria-label={t("Idioma")}
          className={
            compact
              ? "h-8 items-center gap-1.5 border-transparent px-2"
              : "h-11 w-full rounded-2xl px-4"
          }
        >
          <LanguagesIcon aria-hidden="true" className="size-4" />
          <SelectValue>
            {compact ? locale.toUpperCase() : localeNames[locale]}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(localeNames).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {failed && (
        <p
          role="alert"
          className={
            compact
              ? "absolute top-full left-0 mt-1 type-caption"
              : "type-caption"
          }
        >
          {t("Não foi possível salvar o idioma. Tente novamente.")}
        </p>
      )}
    </div>
  );
}

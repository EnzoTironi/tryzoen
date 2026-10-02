import { Fragment, useMemo, type ReactNode } from "react";
import { useI18n } from "./context";

/** Preserve interpolated links, emphasis, and user content as React nodes. */
export function Translated({
  message,
  values,
}: {
  readonly message: string;
  readonly values: Readonly<Record<string, ReactNode>>;
}) {
  const { t, locale } = useI18n();
  const numbers = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const template = t(message);
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    parts.push(
      <Fragment key={`text:${offset}`}>
        {template.slice(offset, match.index)}
      </Fragment>
    );
    const name = match[1];
    parts.push(
      <Fragment key={`value:${match.index}`}>
        {name && Object.hasOwn(values, name)
          ? typeof values[name] === "number"
            ? numbers.format(values[name])
            : values[name]
          : match[0]}
      </Fragment>
    );
    offset = match.index + match[0].length;
  }
  parts.push(
    <Fragment key={`text:${offset}`}>{template.slice(offset)}</Fragment>
  );
  return parts;
}

/** Compact inbox time, measured in local calendar days rather than elapsed hours. */
export function conversationTime(
  value: number | string,
  now = new Date(),
  locale?: Intl.LocalesArgument
) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const days =
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) /
    86_400_000;
  const description = date.toLocaleString(locale, {
    dateStyle: "full",
    timeStyle: "short",
  });
  if (days === 0) {
    return {
      label: date.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }),
      description,
    };
  }
  // Hermes may provide DateTimeFormat without RelativeTimeFormat.
  if (days === 1 && typeof Intl.RelativeTimeFormat === "function") {
    return {
      label: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
        -1,
        "day"
      ),
      description,
    };
  }
  return {
    label: date.toLocaleDateString(
      locale,
      days >= 1 && days < 7
        ? { weekday: "short" }
        : {
            day: "numeric",
            month: "short",
            ...(date.getFullYear() !== now.getFullYear()
              ? { year: "numeric" }
              : {}),
          }
    ),
    description,
  };
}

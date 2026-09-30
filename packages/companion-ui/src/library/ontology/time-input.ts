import { z } from "zod";

const minute = z.iso.datetime({ local: true, precision: -1 });
const pad = (value: number) => String(value).padStart(2, "0");

export function localRecordedMinute(instant: string) {
  const date = new Date(instant);
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseRecordedMinute(value: string) {
  const input = value.trim().replace(" ", "T");
  if (!minute.safeParse(input).success) return null;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return null;
  const instant = date.toISOString();
  const nextDay = new Date(date.getTime() + 86_400_000);
  const repeatedMinutes =
    nextDay.getTimezoneOffset() - date.getTimezoneOffset();
  if (
    repeatedMinutes > 0 &&
    localRecordedMinute(
      new Date(date.getTime() + repeatedMinutes * 60_000).toISOString()
    ).replace(" ", "T") === input
  )
    return null;
  // Date normalizes nonexistent local times across a daylight-saving gap.
  // Reject that change rather than silently selecting another recorded view.
  return localRecordedMinute(instant).replace(" ", "T") === input
    ? instant
    : null;
}

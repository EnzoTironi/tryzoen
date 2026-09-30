import { afterEach, expect, test, vi } from "vitest";
import { localRecordedMinute, parseRecordedMinute } from "./time-input";

afterEach(() => vi.unstubAllEnvs());

test("recorded time uses the user's local clock and preserves its instant when reopened", () => {
  vi.stubEnv("TZ", "America/Sao_Paulo");
  const instant = parseRecordedMinute("2026-09-30 10:30");
  expect(instant).toBe("2026-09-30T13:30:00.000Z");
  expect(localRecordedMinute("2026-09-30T10:30:00-03:00")).toBe(
    "2026-09-30 10:30"
  );
});

test("invalid recorded times cannot silently select today's knowledge", () => {
  for (const value of [
    "",
    "2026-02-30 10:30",
    "2026-09-30 24:00",
    "2026-09-30 10:60",
    "2026-09-30",
  ]) {
    expect(parseRecordedMinute(value)).toBeNull();
  }
});

test("a local time missing during the daylight-saving transition is rejected", () => {
  vi.stubEnv("TZ", "America/New_York");
  expect(parseRecordedMinute("2026-03-08 02:30")).toBeNull();
  expect(parseRecordedMinute("2026-03-08 03:30")).toBe(
    "2026-03-08T07:30:00.000Z"
  );
});

test("a repeated local time cannot silently choose one of two recorded instants", () => {
  vi.stubEnv("TZ", "America/New_York");
  expect(parseRecordedMinute("2026-11-01 01:30")).toBeNull();
  vi.stubEnv("TZ", "Australia/Lord_Howe");
  expect(parseRecordedMinute("2026-04-05 01:45")).toBeNull();
  expect(parseRecordedMinute("2026-04-05 01:15")).not.toBeNull();
});

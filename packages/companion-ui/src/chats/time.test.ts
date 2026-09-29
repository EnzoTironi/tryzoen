import { afterEach, expect, it, vi } from "vitest";
import { conversationTime } from "./time";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("shows a local clock today and retains the exact accessible date", () => {
  const date = new Date(2026, 8, 28, 9, 42);
  const time = conversationTime(
    date.toISOString(),
    new Date(2026, 8, 28, 17),
    "en-GB"
  );
  expect(time?.label).toBe("09:42");
  expect(time?.description).toContain("28 September 2026");
  expect(time?.description).toContain("09:42");
});

it("uses yesterday across midnight even when only a minute has elapsed", () => {
  const time = conversationTime(
    new Date(2026, 8, 27, 23, 59).getTime(),
    new Date(2026, 8, 28, 0, 0),
    "pt-BR"
  );
  expect(time?.label).toBe("ontem");
});

it("uses yesterday across year boundaries without treating it as an old year", () => {
  expect(
    conversationTime(
      new Date(2025, 11, 31, 1).getTime(),
      new Date(2026, 0, 1, 23),
      "en-GB"
    )?.label
  ).toBe("yesterday");
});

it("uses weekdays only for the preceding six calendar days", () => {
  const now = new Date(2026, 8, 28, 12);
  expect(
    conversationTime(new Date(2026, 8, 26).getTime(), now, "en-GB")?.label
  ).toBe("Sat");
  expect(
    conversationTime(new Date(2026, 8, 21).getTime(), now, "en-GB")?.label
  ).toBe("21 Sept");
});

it("includes the year for older years and a date for future activity", () => {
  const now = new Date(2026, 8, 28, 12);
  expect(
    conversationTime(new Date(2025, 8, 28).getTime(), now, "en-GB")?.label
  ).toBe("28 Sept 2025");
  expect(
    conversationTime(new Date(2026, 8, 29).getTime(), now, "en-GB")?.label
  ).toBe("29 Sept");
});

it("does not expose Invalid Date for unusable metadata", () => {
  expect(conversationTime("invalid")).toBeNull();
});

it("uses a localized weekday on native engines without relative time support", () => {
  vi.stubGlobal(
    "Intl",
    new Proxy(Intl, {
      get(target, property, receiver): unknown {
        return property === "RelativeTimeFormat"
          ? undefined
          : Reflect.get(target, property, receiver);
      },
    })
  );
  expect(
    conversationTime(
      new Date(2026, 8, 27).getTime(),
      new Date(2026, 8, 28),
      "en-GB"
    )?.label
  ).toBe("Sun");
});

import { afterEach, expect, it, vi } from "vitest";
import {
  deviceLocale,
  readLocalePreference,
  saveLocalePreference,
} from "./locale";

afterEach(() => vi.unstubAllGlobals());

it("detects the device language and keeps an explicit choice across restarts", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("navigator", { languages: ["es-MX", "en-US"] });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  expect(deviceLocale()).toBe("es");
  expect(await readLocalePreference()).toBeUndefined();
  await saveLocalePreference("pt-BR");
  expect(await readLocalePreference()).toBe("pt-BR");
  vi.stubGlobal("navigator", { languages: ["en-US"] });
  expect(await readLocalePreference()).toBe("pt-BR");
  await saveLocalePreference("en");
  expect(await readLocalePreference()).toBe("en");
  values.set("zoen.locale", "unsupported");
  expect(await readLocalePreference()).toBeUndefined();
});

it("reports a failed preference write instead of silently changing the saved language", async () => {
  vi.stubGlobal("localStorage", {
    setItem: () => {
      throw new Error("Storage unavailable");
    },
  });
  await expect(saveLocalePreference("es")).rejects.toThrow(
    "Storage unavailable"
  );
});

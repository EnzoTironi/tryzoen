import { session } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import { desktopText, refreshDesktopLanguage } from "./i18n";

const cookies = vi.hoisted(() => ({
  get: vi.fn<typeof session.defaultSession.cookies.get>(),
}));
vi.mock("electron", () => ({
  app: { getLocale: () => "en-US" },
  session: { defaultSession: { cookies } },
}));
beforeEach(() => cookies.get.mockReset());

it("uses the browser's saved choice for native dialogs and returns to the device locale when cleared", async () => {
  cookies.get.mockResolvedValue([{ name: "zoen-locale", value: "es" }]);
  await refreshDesktopLanguage(
    session.defaultSession,
    "https://example.com/companion"
  );
  expect(cookies.get).toHaveBeenCalledWith({
    url: "https://example.com/companion",
    name: "zoen-locale",
  });
  expect(desktopText("Unable to open your browser.")).toBe(
    "No se pudo abrir tu navegador."
  );
  cookies.get.mockResolvedValue([{ name: "zoen-locale", value: "pt-BR" }]);
  await refreshDesktopLanguage(
    session.defaultSession,
    "https://example.com/companion"
  );
  expect(desktopText("New conversation")).toBe("Nova conversa");
  cookies.get.mockResolvedValue([]);
  await refreshDesktopLanguage(
    session.defaultSession,
    "https://example.com/companion"
  );
  expect(desktopText("New conversation")).toBe("New conversation");
});

it("keeps the latest choice when cookie reads finish out of order", async () => {
  let finishEarlier:
    | ((value: Awaited<ReturnType<typeof cookies.get>>) => void)
    | undefined;
  cookies.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishEarlier = resolve;
      })
  );
  const earlier = refreshDesktopLanguage(
    session.defaultSession,
    "https://example.com/companion"
  );
  cookies.get.mockResolvedValueOnce([{ name: "zoen-locale", value: "es" }]);
  await refreshDesktopLanguage(
    session.defaultSession,
    "https://example.com/companion"
  );
  finishEarlier?.([{ name: "zoen-locale", value: "pt-BR" }]);
  await earlier;
  expect(desktopText("New conversation")).toBe("Nueva conversación");
});

import { expect, it, vi } from "vitest";
import LegacyLayout from "./layout";

vi.mock("@shared/environment", () => ({
  env: { ZOEN_LEGACY_APP_ENABLED: false },
}));
vi.mock("./legacy-shell", () => ({
  default: () => <section>Legacy workspace</section>,
  generateMetadata: async () => ({ title: "Legacy" }),
}));

it("does not expose the legacy interface in Companion production", () => {
  expect(() =>
    LegacyLayout({
      children: <p>Workspace content</p>,
      params: Promise.resolve({}),
    })
  ).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
});

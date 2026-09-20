import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { describe, expect, it } from "vitest";
import { OnboardingProvider } from "../../_components/onboarding";
import { DocsPanel } from "../_components/docs-panel";

describe("docs panel", () => {
  it("describes the hosted first-run on tryzoen.com", () => {
    const html = renderToStaticMarkup(
      <OnboardingProvider
        destinations={{ whatsapp: null, telegram: null, imessage: null }}
      >
        <DocsPanel />
      </OnboardingProvider>
    );
    expect(html).toContain("tryzoen.com");
    expect(html).toContain("https://tryzoen.com");
    expect(html).not.toContain("zoen.tironi.xyz");
    expect(html).not.toContain("zoen.space");
    expect(html).not.toContain("poke.com");
    expect(html).toContain("Primeiros passos");
    expect(html).not.toContain('aria-haspopup="dialog"');
    expect(html).toContain('href="/get-started"');
    expect(html).toContain('href="/"');
  });
});

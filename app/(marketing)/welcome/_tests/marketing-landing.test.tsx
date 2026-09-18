import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { describe, expect, it } from "vitest";
import { OnboardingProvider } from "../../_components/onboarding";
import { MarketingLanding } from "../_components/marketing-landing";

describe("marketing landing", () => {
  it("uses the production host and conversion paths", () => {
    const html = renderToStaticMarkup(
      <OnboardingProvider
        destinations={{
          whatsapp: "https://wa.me/15551234567",
          telegram: "https://t.me/companion_test_bot",
          imessage: "sms:+15557654321",
        }}
      >
        <MarketingLanding />
      </OnboardingProvider>
    );
    expect(html).toContain("zoen.tironi.xyz");
    expect(html).toContain("https://zoen.tironi.xyz");
    expect(html).not.toContain("zoen.space");
    expect(html).not.toContain("poke.com");
    expect(html).not.toContain("Ver todos os planos");
    expect(html).toContain("Começar agora");
    expect(html).not.toContain('aria-haspopup="dialog"');
    expect(html).toContain('href="/get-started"');
    expect(html).not.toContain('href="/pricing"');
    expect(html).toContain('href="/docs"');
    expect(html).toContain('href="https://wa.me/15551234567"');
    expect(html).toContain('href="https://t.me/companion_test_bot"');
    expect(html).toContain('href="sms:+15557654321"');
    expect(html).not.toContain('target="_blank"');
  });

  it("shows only iMessage and opens the weekend SMS draft", () => {
    const html = renderToStaticMarkup(
      <OnboardingProvider
        destinations={{
          whatsapp: null,
          telegram: null,
          imessage:
            "sms:+16282463032?&body=Set%20this%20up%20for%20me%3A%20aiworthusing.com%2Fagent-index%2Fzoen",
        }}
      >
        <MarketingLanding />
      </OnboardingProvider>
    );
    expect(html).toContain(
      "sms:+16282463032?&amp;body=Set%20this%20up%20for%20me%3A%20aiworthusing.com%2Fagent-index%2Fzoen"
    );
    expect(html).toContain('aria-label="iMessage"');
    expect(html).not.toContain('aria-label="WhatsApp"');
    expect(html).not.toContain('aria-label="Telegram"');
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("t.me/");
    expect(html).not.toContain('href="/get-started"');
  });
});

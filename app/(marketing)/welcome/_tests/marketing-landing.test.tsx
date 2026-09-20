import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { describe, expect, it } from "vitest";
import { OnboardingProvider } from "../../_components/onboarding";
import { MarketingLanding } from "../_components/marketing-landing";

describe("marketing landing", () => {
  it.each([
    [
      "pt-BR",
      "Idioma",
      "Seu dia, seu trabalho, suas pessoas. Um Zoen.",
      "Mensagens",
    ],
    [
      "en",
      "Language",
      "Your day, your work, your people. One Zoen.",
      "Messages",
    ],
    ["es", "Idioma", "Tu día, tu trabajo, tu gente. Un Zoen.", "Mensajes"],
  ] as const)(
    "exposes language selection in the %s landing header",
    (locale, label, copy, messages) => {
      const html = renderToStaticMarkup(
        <OnboardingProvider
          destinations={{
            whatsapp: null,
            telegram: null,
            imessage: "sms:+15557654321",
          }}
        >
          <MarketingLanding />
        </OnboardingProvider>,
        locale
      );
      const header = /<header[\s\S]*?<\/header>/u.exec(html)?.[0];
      expect(header).toContain(`aria-label="${label}"`);
      expect(header).toContain('role="combobox"');
      expect(html).toContain(copy);
      expect(html).toContain(`aria-label="${messages}"`);
      expect(html).toContain('href="sms:+15557654321"');
    }
  );

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
    expect(html).toContain("tryzoen.com");
    expect(html).toContain("https://tryzoen.com");
    expect(html).not.toContain("zoen.tironi.xyz");
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

  it("shows only SMS and opens the weekend draft", () => {
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
    expect(html).toContain('aria-label="Mensagens"');
    expect(html).toContain("mande uma mensagem");
    expect(html).not.toContain("abra o iMessage");
    expect(html).not.toContain("mande um SMS");
    expect(html).not.toContain('aria-label="WhatsApp"');
    expect(html).not.toContain('aria-label="Telegram"');
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("t.me/");
    expect(html).not.toContain('href="/get-started"');
  });
});

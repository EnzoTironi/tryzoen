import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { describe, expect, it } from "vitest";
import {
  WEEKEND_IMESSAGE_URL,
  weekendPublicDestinations,
} from "../../../../server/channels/destination";
import { OnboardingProvider } from "../../_components/onboarding";
import { MarketingLanding } from "../_components/marketing-landing";

const weekendHref = WEEKEND_IMESSAGE_URL.replaceAll("&", "&amp;");

describe("marketing landing", () => {
  it.each([
    [
      "pt-BR",
      "Idioma",
      "Seu dia, seu trabalho, suas pessoas. Um Zoen.",
      "Deixa com a Zoen",
      "Comece a conversar agora",
      "Mensagens",
    ],
    [
      "en",
      "Language",
      "Your day, your work, your people. One Zoen.",
      "Leave it with Zoen",
      "Start talking now",
      "Messages",
    ],
    [
      "es",
      "Idioma",
      "Tu día, tu trabajo, tu gente. Un Zoen.",
      "Déjaselo a Zoen",
      "Empieza a conversar ahora",
      "Mensajes",
    ],
  ] as const)(
    "exposes language selection in the %s landing header",
    (locale, label, copy, reply, start, messages) => {
      const html = renderToStaticMarkup(
        <OnboardingProvider destinations={weekendPublicDestinations}>
          <MarketingLanding />
        </OnboardingProvider>,
        locale
      );
      const header = /<header[\s\S]*?<\/header>/u.exec(html)?.[0];
      expect(header).toContain(`aria-label="${label}"`);
      expect(header).toContain('role="combobox"');
      expect(header).not.toContain("Entrar");
      expect(header).not.toContain("/sign-in");
      expect(html).toContain(copy);
      expect(html).toContain(reply);
      expect(html).toContain(start);
      expect(html).toContain(`aria-label="${messages}"`);
      expect(html).toContain(`href="${weekendHref}"`);
    }
  );

  it("sends every landing start control to the weekend iMessage draft", () => {
    const html = renderToStaticMarkup(
      <OnboardingProvider destinations={weekendPublicDestinations}>
        <MarketingLanding />
      </OnboardingProvider>
    );
    expect(html).toContain("tryzoen.com");
    expect(html).toContain("https://tryzoen.com");
    expect(html).not.toContain("zoen.tironi.xyz");
    expect(html).not.toContain("zoen.space");
    expect(html).not.toContain("poke.com");
    expect(html).not.toContain("Ver todos os planos");
    expect(html).toContain("Comece a conversar agora");
    expect(html).toContain("Deixa com a Zoen");
    expect(html).not.toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('href="/get-started"');
    expect(html).not.toContain('href="/sign-in"');
    expect(html).not.toContain('href="/pricing"');
    expect(html).toContain('href="/docs"');
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("t.me/");
    expect(html).not.toContain('aria-label="WhatsApp"');
    expect(html).not.toContain('aria-label="Telegram"');
    expect(html).toContain(`href="${weekendHref}"`);
    expect(html.match(/href="sms:\+16282463032\?&amp;body=/g)?.length).toBe(5);
    expect(html).not.toContain('target="_blank"');
  });

  it("shows only SMS and opens the weekend draft", () => {
    const html = renderToStaticMarkup(
      <OnboardingProvider destinations={weekendPublicDestinations}>
        <MarketingLanding />
      </OnboardingProvider>
    );
    expect(html).toContain(weekendHref);
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

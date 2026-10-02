import { expect, it, vi } from "vitest";
import { renderToLocalizedMarkup } from "../../../../tests/helpers/companion-i18n";
import { CompanionOverlayProvider } from "../overlay";
import { SettingsPanel } from "../settings";
import { RoomTypingIndicator } from "../rooms/typing-indicator";
import { conversationTime } from "../chats/time";
import { LanguageOptions } from "./language-options";
import { Translated } from "./translated";

vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => import("lucide-react"));

it.each([
  ["en", "Settings", "Close settings", "Credential vault", "Language"],
  [
    "es",
    "Configuración",
    "Cerrar configuración",
    "Almacenamiento seguro de credenciales",
    "Idioma",
  ],
  [
    "pt-BR",
    "Configurações",
    "Fechar configurações",
    "Armazenamento seguro de credenciais",
    "Idioma",
  ],
] as const)(
  "renders shared settings and accessible language controls in %s",
  (locale, title, close, vault, language) => {
    const html = renderToLocalizedMarkup(
      <CompanionOverlayProvider
        renderOverlay={({ title: label, children }) => (
          <section aria-label={label}>{children}</section>
        )}
      >
        <SettingsPanel
          onSelect={() => undefined}
          onBack={() => undefined}
          onClose={() => undefined}
          onSignOut={() => undefined}
          signingOut={false}
        />
        <LanguageOptions onChange={async () => undefined} />
      </CompanionOverlayProvider>,
      locale
    );
    expect(html).toContain(`aria-label="${title}"`);
    expect(html).toContain(`aria-label="${close}"`);
    expect(html).toContain(vault);
    expect(html).toContain(`aria-label="${language}"`);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-checked="true"');
  }
);

it("uses the selected language for typing conjunctions while preserving people's names", () => {
  const members = ["Ana", "James"].map((name) => ({
    id: name,
    name,
    mine: false,
    bot: false,
  }));
  const node = (
    <RoomTypingIndicator
      userIds={members.map((person) => person.id)}
      members={members}
    />
  );
  expect(renderToLocalizedMarkup(node, "en")).toContain("Ana and James");
  expect(renderToLocalizedMarkup(node, "es")).toContain("Ana y James");
  expect(renderToLocalizedMarkup(node, "pt-BR")).toContain("Ana e James");
});

it("formats inbox dates in the selected language rather than the machine's default", () => {
  const now = new Date(2026, 9, 2, 12);
  const previous = new Date(2026, 9, 1, 12).getTime();
  expect(conversationTime(previous, now, "en")?.label).toBe("yesterday");
  expect(conversationTime(previous, now, "es")?.label).toBe("ayer");
  expect(conversationTime(previous, now, "pt-BR")?.label).toBe("ontem");
});

it("keeps linked and untrusted content intact inside a translated sentence", () => {
  const node = (
    <Translated
      message="Updated {date}"
      values={{
        date: (
          <a href="https://example.com/history">{"<script>{name}</script>"}</a>
        ),
      }}
    />
  );
  expect(renderToLocalizedMarkup(node, "es")).toBe(
    'Actualizado <a href="https://example.com/history">&lt;script&gt;{name}&lt;/script&gt;</a>'
  );
});

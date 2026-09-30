import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { CompanionShell } from "./shell";

const state = vi.hoisted(() => ({ width: 1000, dark: false }));
vi.mock("react-native", async () => ({
  ...(await vi.importActual<typeof import("react-native")>("react-native-web")),
  useWindowDimensions: () => ({
    width: state.width,
    height: 800,
    scale: 1,
    fontScale: 1,
  }),
  useColorScheme: () => (state.dark ? "dark" : "light"),
}));
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("./conversation", async () => ({
  ConversationChrome: (await import("react")).createContext({
    topInset: 0,
    compact: true,
  }),
}));

function render(
  open = true,
  section: ComponentProps<typeof CompanionShell>["section"] = "chat"
) {
  return renderToStaticMarkup(
    <CompanionShell
      conversationOpen={open}
      section={section}
      renderConversations={() => <span>Inbox</span>}
      onShowInbox={vi.fn<
        NonNullable<ComponentProps<typeof CompanionShell>["onShowInbox"]>
      >()}
      onNavigate={vi.fn<
        NonNullable<ComponentProps<typeof CompanionShell>["onNavigate"]>
      >()}
      onNewConversation={vi.fn<
        NonNullable<ComponentProps<typeof CompanionShell>["onNewConversation"]>
      >()}
      renderAgentPanel={() => <span>Agent details</span>}
    >
      <span>Chat</span>
    </CompanionShell>
  );
}
beforeEach(() => {
  state.width = 1000;
  state.dark = false;
});
it("exposes real desktop destinations alongside the two messaging panes", () => {
  const html = render();
  expect(html).toContain('data-testid="conversation-sidebar"');
  expect(html).toContain('data-testid="conversation-content"');
  expect(html).toContain('data-testid="global-navigation"');
  for (const label of [
    "Conversas",
    "Buscar",
    "Atividade",
    "Ideias",
    "Objetivos",
    "Biblioteca",
    "Agentes",
    "Ajustes",
  ])
    expect(html).toContain(`aria-label="${label}"`);
  expect(html).toContain('aria-label="Expandir navegação"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('aria-label="Detalhes da conversa"');

  expect(html).not.toContain("Agent details");
});
it("keeps the mobile composer screen free of a permanent bottom navigation bar", () => {
  state.width = 390;
  const html = render();
  expect(html).toContain('aria-label="Voltar às conversas"');
  expect(html).not.toContain('data-testid="mobile-navigation"');
  expect(html).not.toContain('data-testid="global-navigation"');
  expect(html).not.toContain('aria-label="Biblioteca"');
  expect(html).not.toContain('aria-label="Ajustes"');
});
it("uses live system appearance for the owned shell", () => {
  const light = render();
  state.dark = true;
  expect(render()).not.toEqual(light);
  state.dark = false;
  expect(render()).toEqual(light);
});

it("shows primary destinations on mobile top-level screens, including an open conversation behind another section", () => {
  state.width = 390;
  for (const html of [render(false), render(true, "library")]) {
    expect(html).toContain('data-testid="mobile-navigation"');
    for (const label of [
      "Conversas",
      "Atividade",
      "Biblioteca",
      "Agentes",
      "Mais",
    ])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toContain('data-testid="global-navigation"');
  }
});

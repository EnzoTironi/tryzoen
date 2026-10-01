import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { CompanionShell } from "./shell";

const state = vi.hoisted(() => ({
  width: 1000,
  dark: false,
  labelColor: "",
  selectedFill: "",
}));
vi.mock("react-native", async () => {
  const native =
    await vi.importActual<typeof import("react-native")>("react-native-web");
  return {
    ...native,
    useWindowDimensions: () => ({
      width: state.width,
      height: 800,
      scale: 1,
      fontScale: 1,
    }),
    useColorScheme: () => (state.dark ? "dark" : "light"),
    Text: (props: ComponentProps<typeof import("react-native").Text>) => {
      const style = native.StyleSheet.flatten(props.style);
      if (
        props.children === "Conversas" &&
        style.fontSize === 10 &&
        typeof style.color === "string"
      )
        state.labelColor = style.color;
      return <native.Text {...props} />;
    },
    Pressable: (
      props: ComponentProps<typeof import("react-native").Pressable>
    ) => {
      if (props.accessibilityLabel === "Conversas") {
        const style = native.StyleSheet.flatten(
          typeof props.style === "function"
            ? props.style({ pressed: false })
            : props.style
        );
        if (typeof style.backgroundColor === "string")
          state.selectedFill = style.backgroundColor;
      }
      return <native.Pressable {...props} />;
    },
  };
});
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
  state.labelColor = "";
  state.selectedFill = "";
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

function linear(value: number) {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}
function luminance(color: string) {
  if (!/^#[\da-f]{6}$/iu.test(color))
    throw new Error(`Invalid color: ${color}`);
  const packed = Number.parseInt(color.slice(1), 16);
  return (
    linear((packed >> 16) & 255) * 0.2126 +
    linear((packed >> 8) & 255) * 0.7152 +
    linear(packed & 255) * 0.0722
  );
}

it.each([false, true])(
  "keeps the selected mobile label readable in dark appearance %s",
  (dark) => {
    state.width = 390;
    state.dark = dark;
    const markup = render(false);
    const values = [luminance(state.labelColor), luminance(state.selectedFill)];
    expect(
      (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
    ).toBeGreaterThanOrEqual(4.5);
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Conversas"');
  }
);

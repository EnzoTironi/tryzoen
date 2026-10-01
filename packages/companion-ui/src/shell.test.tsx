import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompanionShell } from "./shell";

const state = vi.hoisted(() => ({
  width: 1000,
  dark: false,
  labelColor: "",
  selectedFill: "",
  platform: "web",
  blurSupported: true,
  preferences: {
    reduceMotion: false,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  },
  materials: [] as Record<string, unknown>[],
  header: undefined as
    | ComponentProps<typeof import("react-native").View>
    | undefined,
}));
vi.mock("react-native", async () => {
  const native =
    await vi.importActual<typeof import("react-native")>("react-native-web");
  return {
    ...native,
    Platform: {
      ...native.Platform,
      get OS() {
        return state.platform;
      },
    },
    View: (props: ComponentProps<typeof import("react-native").View>) => {
      const style = native.StyleSheet.flatten(props.style);
      if (props.testID === "conversation-header") state.header = props;
      if (props.style && style.backdropFilter) state.materials.push(style);
      return <native.View {...props} />;
    },
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
vi.mock("./theme", async (original) => ({
  ...(await original<typeof import("./theme")>()),
  useAccessibilityPreferences: () => state.preferences,
}));
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
  state.materials = [];
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
  state.platform = "web";
  state.blurSupported = true;
  state.preferences = {
    reduceMotion: false,
    reduceTransparency: false,
    increasedContrast: false,
    forcedColors: false,
  };
  state.header = undefined;
  vi.stubGlobal("CSS", { supports: () => state.blurSupported });
});
afterEach(() => {
  vi.unstubAllGlobals();
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

function geometry(style: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(style).filter(
      ([key]) =>
        !["backgroundColor", "borderColor", "backdropFilter"].includes(key)
    )
  );
}
it.each([false, true])(
  "keeps header materials independent of motion in dark %s",
  (dark) => {
    state.dark = dark;
    render();
    const normal = state.materials;
    expect(normal).toHaveLength(3);
    state.preferences.reduceMotion = true;
    render();
    expect(state.materials).toEqual(normal);
    expect(state.header?.pointerEvents).toBe("box-none");
    expect(state.header?.style).toBeDefined();
    expect(
      normal.every(
        (style) =>
          typeof style.backgroundColor === "string" &&
          style.backgroundColor.endsWith("b8")
      )
    ).toBe(true);
  }
);
it.each([false, true])(
  "keeps header geometry and actions when transparency is reduced in dark %s",
  (dark) => {
    state.width = 390;
    state.dark = dark;
    render();
    const normal = state.materials.map(geometry);
    state.preferences.reduceTransparency = true;
    const markup = render();
    expect(state.materials.map(geometry)).toEqual(normal);
    expect(state.materials.map((style) => style.backgroundColor)).toEqual(
      Array(3).fill(dark ? "#1c1c1e" : "#ffffff")
    );
    expect(state.materials.map((style) => style.backdropFilter)).toEqual(
      Array(3).fill("none")
    );
    expect(markup).toContain('aria-label="Voltar às conversas"');
    expect(markup).toContain('aria-label="Detalhes da conversa"');
    expect(state.header?.pointerEvents).toBe("box-none");
  }
);
it.each(["increasedContrast", "forcedColors"] as const)(
  "reinforces controls for %s without changing the transparency preference",
  (preference) => {
    render();
    const normal = state.materials.map(geometry);
    state.preferences[preference] = true;
    render();
    expect(state.preferences.reduceTransparency).toBe(false);
    expect(state.materials.map(geometry)).toEqual(normal);
    expect(state.materials.map((style) => style.borderColor)).toEqual(
      Array(3).fill("#1c1c1e")
    );
    expect(state.materials.map((style) => style.backgroundColor)).toEqual(
      Array(3).fill("#ffffff")
    );
  }
);
it.each(["native", "unsupported-blur"])(
  "uses an opaque header when %s cannot provide material",
  (capability) => {
    state.platform = capability === "native" ? "ios" : "web";
    state.blurSupported = capability !== "unsupported-blur";
    const markup = render();
    expect(markup).toContain('aria-label="Detalhes da conversa"');
    const native = capability === "native";
    expect(state.materials).toHaveLength(native ? 0 : 3);
    expect(state.materials.map((style) => style.backdropFilter)).toEqual(
      Array(native ? 0 : 3).fill("none")
    );
  }
);

import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Text, View } from "react-native";
import { beforeEach, expect, it, vi } from "vitest";
import { Library } from "./library";

const state = vi.hoisted(() => ({
  dark: false,
  preview: "",
  title: "",
}));
vi.mock("react-native", async () => {
  const native =
    await vi.importActual<typeof import("react-native")>("react-native-web");
  return {
    ...native,
    useColorScheme: () => (state.dark ? "dark" : "light"),
    View: (props: ComponentProps<typeof View>) => {
      const style = native.StyleSheet.flatten(props.style);
      if (style.height === 190 && typeof style.backgroundColor === "string")
        state.preview = style.backgroundColor;
      return <native.View {...props} />;
    },
    Text: (props: ComponentProps<typeof Text>) => {
      const style = native.StyleSheet.flatten(props.style);
      if (style.fontSize === 23 && typeof style.color === "string")
        state.title = style.color;
      return <native.Text {...props} />;
    },
  };
});
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("./library/knowledge", () => ({ KnowledgeProposals: () => null }));
vi.mock("./library/ontology/collection", () => ({
  OntologyCollection: () => null,
}));

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
function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

const onOpen = vi.fn<ComponentProps<typeof Library>["onOpen"]>();
const proposals: ComponentProps<typeof Library>["proposals"] = {
  cacheKey: ["test-proposals"],
  operationId:
    vi.fn<ComponentProps<typeof Library>["proposals"]["operationId"]>(),
  list: vi.fn<ComponentProps<typeof Library>["proposals"]["list"]>(),
  read: vi.fn<ComponentProps<typeof Library>["proposals"]["read"]>(),
  review: vi.fn<ComponentProps<typeof Library>["proposals"]["review"]>(),
};
const ontology: ComponentProps<typeof Library>["ontology"] = {
  cacheKey: ["test-ontology"],
  read: vi.fn<ComponentProps<typeof Library>["ontology"]["read"]>(),
  source: vi.fn<ComponentProps<typeof Library>["ontology"]["source"]>(),
  history: vi.fn<ComponentProps<typeof Library>["ontology"]["history"]>(),
};
function render() {
  return renderToStaticMarkup(
    <Library
      items={[
        {
          id: "knowledge/data/launch_tasks.csv",
          title: "launch_tasks.csv",
          description: "knowledge/data/launch_tasks.csv",
        },
      ]}
      proposals={proposals}
      ontology={ontology}
      onOpen={onOpen}
      onCreate={vi.fn<ComponentProps<typeof Library>["onCreate"]>()}
    />
  );
}
beforeEach(() => {
  state.dark = false;
  state.preview = "";
  state.title = "";
  vi.clearAllMocks();
});

it.each([false, true])(
  "keeps normal preview text legible with dark appearance %s",
  (dark) => {
    state.dark = dark;
    const markup = render();
    expect(contrast(state.title, state.preview)).toBeGreaterThanOrEqual(4.5);
    expect(markup).toContain('aria-label="launch_tasks.csv"');
    expect(markup).toContain("knowledge/data/launch_tasks.csv");
    expect(onOpen).not.toHaveBeenCalled();
  }
);

it("adapts the existing preview surface light to dark to light", () => {
  render();
  const light = { foreground: state.title, background: state.preview };
  state.dark = true;
  render();
  expect(state.preview).not.toBe(light.background);
  expect(state.title).not.toBe(light.foreground);
  state.dark = false;
  render();
  expect({ foreground: state.title, background: state.preview }).toEqual(light);
});

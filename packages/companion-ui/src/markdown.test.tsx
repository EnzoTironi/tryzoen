import { renderToSourceMarkup as renderToStaticMarkup } from "../../../tests/helpers/companion-i18n";
import type { ComponentProps } from "react";
import type Markdown from "react-native-marked";
import { expect, test, vi } from "vitest";
import { AssistantMarkdown } from "./markdown";

const state = vi.hoisted(() => ({
  scheme: "light" as "light" | "dark",
  props: undefined as ComponentProps<typeof Markdown> | undefined,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  StyleSheet: { create: <T,>(value: T) => value },
  useColorScheme: () => state.scheme,
}));
vi.mock("react-native-marked", () => ({
  Renderer: class {
    getKey() {
      return "synthetic";
    }
  },
  default: (props: ComponentProps<typeof Markdown>) => {
    state.props = props;
    return <span>{props.value}</span>;
  },
}));

test.each(["light", "dark"] as const)(
  "%s outgoing markdown retains visible body, links and code",
  (scheme) => {
    state.scheme = scheme;
    renderToStaticMarkup(
      <AssistantMarkdown
        text="hello [link](https://example.invalid) `code`"
        compact
        outgoing
      />
    );
    const outgoing = state.props;
    renderToStaticMarkup(<AssistantMarkdown text="hello" compact />);
    const incoming = state.props;
    expect(outgoing?.theme?.colors?.text).toBe("#ffffff");
    expect(outgoing?.theme?.colors?.link).toBe(outgoing?.theme?.colors?.text);
    expect(outgoing?.styles?.codespan?.color).toBe(
      incoming?.theme?.colors?.text
    );
    expect(outgoing?.styles?.codeText?.color).toBe(
      incoming?.theme?.colors?.text
    );
    expect(outgoing?.styles?.link?.textDecorationLine).toBe("underline");
    expect(incoming?.theme?.colors?.text).not.toBe(
      outgoing?.theme?.colors?.text
    );
  }
);

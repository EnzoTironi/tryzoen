import { createElement, type ReactNode } from "react";
import { renderToSourceMarkup as renderToStaticMarkup } from "../../../tests/helpers/companion-i18n";
import { expect, it, vi } from "vitest";
import { AssistantMarkdown } from "../src/markdown";

vi.mock("react-native", () => import("react-native-web"));
vi.mock("react-native-marked", () => {
  class Renderer {
    getKey() {
      return "preview";
    }
    image(uri: string, alt?: string) {
      return createElement("img", { src: uri, alt });
    }
    link(children: ReactNode, href: string) {
      return <a href={href}>{children}</a>;
    }
  }
  return {
    Renderer,
    default: ({ value, renderer }: { value: string; renderer: Renderer }) => (
      <>
        {renderer.image(value, "Private diagram")}
        {renderer.link("Reference", value)}
      </>
    ),
  };
});

it("renders private image descriptions without contacting a remote host", () => {
  const html = renderToStaticMarkup(
    <AssistantMarkdown
      text="https://example.invalid/tracking.png"
      allowImages={false}
    />
  );
  expect(html).toContain("Private diagram");
  expect(html).not.toContain("<img");
  expect(html).not.toContain('rel="preload"');
  expect(html).toContain(
    '<a href="https://example.invalid/tracking.png">Reference</a>'
  );
});

it("keeps safe images available to conversation previews", () => {
  const html = renderToStaticMarkup(
    <AssistantMarkdown text="https://example.invalid/photo.png" />
  );
  expect(html).toContain('<img src="https://example.invalid/photo.png"');
});

it.each([
  "javascript:alert(1)",
  "file:///private/note.md",
  "data:image/svg+xml,<svg/>",
])("never delegates unsafe URLs to the external renderer: %s", (url) => {
  const html = renderToStaticMarkup(<AssistantMarkdown text={url} />);
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<a");
  expect(html).toContain("Private diagram");
  expect(html).toContain("Reference");
});

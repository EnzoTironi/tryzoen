import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Button, buttonVariants } from "@web/components/ui/button";

const stylesheet = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
);
const fill =
  /\[data-slot="button"\]\[data-variant="default"\]\s*\{[^}]*--primary:\s*(#[\da-f]{6})/iu.exec(
    stylesheet
  )?.[1];
if (!fill) throw new Error("The filled button palette is missing.");
function contrast(color: string, dim = 1) {
  if (!/^#[\da-f]{6}$/iu.test(color))
    throw new Error(`Invalid color: ${color}`);
  const packed = Number.parseInt(color.slice(1), 16);
  const linear = (channel: number) => {
    const value = (channel / 255) * dim;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const background =
    linear((packed >> 16) & 255) * 0.2126 +
    linear((packed >> 8) & 255) * 0.7152 +
    linear(packed & 255) * 0.0722;
  return 1.05 / (background + 0.05);
}

it("keeps white normal text readable on the enabled filled button in either appearance", () => {
  expect(fill).toBeDefined();
  expect(contrast(fill)).toBeGreaterThanOrEqual(4.5);
  const markup = renderToStaticMarkup(<Button>Salvar</Button>);
  expect(markup).toContain('data-slot="button"');
  expect(markup).toContain('data-variant="default"');
  expect(markup).toContain("Salvar");
  expect(markup).not.toContain('disabled=""');
});

it("keeps enabled hover text readable rather than fading the fill into the page", () => {
  const hover =
    /hover:bg-\[color-mix\(in_srgb,var\(--primary\),black_(\d+)%\)\]/u.exec(
      buttonVariants()
    )?.[1];
  if (!hover) throw new Error("The enabled hover fill is missing.");
  expect(contrast(fill, 1 - Number(hover) / 100)).toBeGreaterThanOrEqual(4.5);
});

it.each(["outline", "secondary", "ghost", "link", "destructive"] as const)(
  "keeps the %s variant outside the filled-button color scope",
  (variant) => {
    const markup = renderToStaticMarkup(
      <Button variant={variant} disabled aria-label="Existing action">
        Action
      </Button>
    );
    expect(markup).toContain(`data-variant="${variant}"`);
    expect(markup).not.toContain('data-variant="default"');
    expect(markup).toContain('aria-label="Existing action"');
    expect(markup).toContain('disabled=""');
  }
);

import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { describe, expect, it } from "vitest";
import { chatStarters } from "../_lib/chat-starters";
import { RecipeGallery } from "./recipe-gallery";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

const searchParams = new URLSearchParams("space=team-audit");

describe("recipe entry points", () => {
  it("featured recipes open known, nonempty editable chat starters", () => {
    const html = renderToStaticMarkup(<RecipeGallery />);
    expect(new Set(chatStarters.map(({ id }) => id)).size).toBe(
      chatStarters.length
    );
    const destinations = [
      ...html.matchAll(/href="\/chat\?starter=([^"]+)"/g),
    ].map((match) => match[1]);
    expect(destinations).toHaveLength(3);
    for (const id of destinations) {
      const recipe = chatStarters.find((item) => item.id === id);
      expect(recipe?.text.trim().length).toBeGreaterThan(0);
    }
    expect(html).not.toContain('target="_blank"');
  });

  it("keeps recipe and freeform conversations in the selected team workspace", () => {
    const html = renderToStaticMarkup(
      <SearchParamsContext.Provider value={searchParams}>
        <RecipeGallery />
      </SearchParamsContext.Provider>
    );
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(
      (match) =>
        new URL((match[1] ?? "").replaceAll("&amp;", "&"), "https://zoen.test")
    );
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(link.pathname).toBe("/chat");
      expect(link.searchParams.get("space")).toBe("team-audit");
    }
  });
});

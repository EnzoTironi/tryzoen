import { expect, it } from "vitest";
import { loadEmojiLabels } from "./labels";

it("provides CLDR names for common reactions and skin tones in each translated language", async () => {
  const spanish = await loadEmojiLabels("es");
  const portuguese = await loadEmojiLabels("pt-BR");
  expect(spanish.get("👍")).toBe("pulgar hacia arriba");
  expect(portuguese.get("👍")).toBe("polegar para cima");
  expect(spanish.get("❤️".replaceAll("\uFE0F", ""))).toBe("corazón rojo");
  expect(portuguese.get("👍🏽")).toContain("pele morena");
});

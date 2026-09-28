import { expect, it } from "vitest";
import { quickReactions, reactionCategories } from "./catalog";
import { messageReactionSchema } from "./schema";

it("offers the six quick reactions and eight disjoint, validated categories", () => {
  expect(quickReactions.map((entry) => entry.emoji)).toEqual([
    "👍",
    "❤️",
    "😂",
    "😮",
    "😢",
    "🙏",
  ]);
  expect(reactionCategories).toHaveLength(8);
  const all = reactionCategories.flatMap((category) => category.items);
  expect(new Set(all.map((entry) => entry.emoji)).size).toBe(all.length);
  for (const entry of all)
    expect(
      messageReactionSchema.safeParse({ messageId: "test", emoji: entry.emoji })
        .success
    ).toBe(true);
});

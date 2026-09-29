import { expect, it } from "vitest";
import { previewReaction } from "./reaction-preview";

const summary = {
  messageId: "$one",
  mine: "❤️",
  mineEventId: "$confirmed",
  complete: true,
  reactions: [
    { emoji: "❤️", count: 3 },
    { emoji: "👍", count: 2 },
  ],
};
it("projects an add, replacement and removal without losing anyone else's reaction or mutating confirmed data", () => {
  expect(previewReaction(summary, "👍")).toEqual({
    ...summary,
    mine: "👍",
    reactions: [
      { emoji: "❤️", count: 2 },
      { emoji: "👍", count: 3 },
    ],
  });
  expect(previewReaction(summary, null).reactions).toEqual([
    { emoji: "❤️", count: 2 },
    { emoji: "👍", count: 2 },
  ]);
  expect(
    previewReaction({ ...summary, mine: null, reactions: [] }, "😂").reactions
  ).toEqual([{ emoji: "😂", count: 1 }]);
  expect(summary.reactions).toEqual([
    { emoji: "❤️", count: 3 },
    { emoji: "👍", count: 2 },
  ]);
});
it("does not double count a confirmed reaction or guess when the provider summary is incomplete", () => {
  expect(previewReaction(summary, "❤️")).toBe(summary);
  const incomplete = { ...summary, complete: false };
  expect(previewReaction(incomplete, "👍")).toBe(incomplete);
  expect(
    previewReaction(
      { ...summary, reactions: [{ emoji: "❤️", count: 1 }] },
      null
    ).reactions
  ).toEqual([]);
});

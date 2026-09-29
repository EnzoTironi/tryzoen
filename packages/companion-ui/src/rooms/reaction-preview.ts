import type { z } from "zod";
import type { roomReactionSummarySchema } from "./schema";

/** A projection of a pending mutation; confirmed event IDs and provider snapshots stay intact. */
export function previewReaction(
  summary: z.infer<typeof roomReactionSummarySchema>,
  emoji: string | null
) {
  if (!summary.complete || summary.mine === emoji) return summary;
  const counts = new Map(
    summary.reactions.map((item) => [item.emoji, item.count])
  );
  if (summary.mine) {
    const count = (counts.get(summary.mine) ?? 1) - 1;
    if (count > 0) counts.set(summary.mine, count);
    else counts.delete(summary.mine);
  }
  if (emoji) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  return {
    ...summary,
    mine: emoji,
    reactions: [...counts].map(([glyph, count]) => ({ emoji: glyph, count })),
  };
}

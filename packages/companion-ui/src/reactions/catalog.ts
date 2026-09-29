import groups from "unicode-emoji-json/data-by-group.json" with { type: "json" };

const emoji = groups.flatMap((group) =>
  group.emojis.map((entry) => ({ ...entry, group: group.name }))
);
const hearts = new Set(
  emoji
    .filter(
      (entry) =>
        entry.group === "Smileys & Emotion" &&
        /heart|love letter|kiss mark/u.test(entry.name)
    )
    .map((entry) => entry.emoji)
);
const hands = new Set(
  emoji
    .filter(
      (entry) =>
        entry.group === "People & Body" &&
        /hand|finger|thumb|fist|clapping|palms|pinching|writing/u.test(
          entry.name
        )
    )
    .map((entry) => entry.emoji)
);

export const reactionCategories = [
  {
    name: "Smileys and people",
    icon: "😀",
    items: emoji.filter(
      (entry) =>
        ["Smileys & Emotion", "People & Body"].includes(entry.group) &&
        !hearts.has(entry.emoji) &&
        !hands.has(entry.emoji)
    ),
  },
  {
    name: "Hand gestures",
    icon: "👋",
    items: emoji.filter((entry) => hands.has(entry.emoji)),
  },
  {
    name: "Hearts",
    icon: "❤️",
    items: emoji.filter((entry) => hearts.has(entry.emoji)),
  },
  {
    name: "Animals and nature",
    icon: "🌿",
    items: emoji.filter((entry) => entry.group === "Animals & Nature"),
  },
  {
    name: "Food and drink",
    icon: "🍎",
    items: emoji.filter((entry) => entry.group === "Food & Drink"),
  },
  {
    name: "Activities",
    icon: "⚽",
    items: emoji.filter((entry) => entry.group === "Activities"),
  },
  {
    name: "Travel and places",
    icon: "✈️",
    items: emoji.filter((entry) => entry.group === "Travel & Places"),
  },
  {
    name: "Symbols",
    icon: "☮️",
    items: emoji.filter((entry) =>
      ["Objects", "Symbols", "Flags"].includes(entry.group)
    ),
  },
] as const;
export { quickReactions } from "./quick";

import { Text } from "react-native";
import type { z } from "zod";
import { colors } from "../theme";
import type { roomMemberSchema } from "./schema";

export function RoomTypingIndicator({
  userIds,
  members,
}: {
  readonly userIds: string[];
  readonly members: z.infer<typeof roomMemberSchema>[];
}) {
  const people = members.filter(
    (person) => !person.mine && userIds.includes(person.id)
  );
  if (!people.length) return null;
  const names = people
    .slice(0, 2)
    .map((person) => person.name)
    .join(" e ");
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={{
        color: colors.muted,
        fontSize: 12,
        paddingHorizontal: 18,
        paddingTop: 6,
      }}
    >
      {names}
      {people.length > 2 ? " e outras pessoas" : ""}
      {people.length === 1
        ? " está digitando nesta conversa…"
        : " estão digitando nesta conversa…"}
    </Text>
  );
}

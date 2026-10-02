import { useI18n } from "./../i18n";
import { Text } from "react-native";
import type { z } from "zod";
import { systemFont, useColors } from "../theme";
import type { roomMemberSchema } from "./schema";

export function RoomTypingIndicator({
  userIds,
  members,
}: {
  readonly userIds: string[];
  readonly members: z.infer<typeof roomMemberSchema>[];
}) {
  const { t, locale } = useI18n();
  const colors = useColors();
  const people = members.filter(
    (person) => !person.mine && userIds.includes(person.id)
  );
  if (!people.length) return null;
  const names = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(people.slice(0, 2).map((person) => person.name));
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={{
        fontFamily: systemFont,
        color: colors.muted,
        fontSize: 12,
        paddingHorizontal: 18,
        paddingTop: 6,
      }}
    >
      {names}
      {people.length > 2 ? t(" e outras pessoas") : ""}
      {people.length === 1
        ? t(" está digitando nesta conversa…")
        : t(" estão digitando nesta conversa…")}
    </Text>
  );
}

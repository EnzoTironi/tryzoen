import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { z } from "zod";
import { CompanionSheet } from "../sheet";
import { ConversationAvatar } from "../chats/avatar";
import { colors } from "../theme";
import type { roomMemberSchema, roomReadReceiptSchema } from "./schema";

/** Exact native event anchors, never a guess from message timestamps or delivery. */
export function MessageReaders({
  receipts,
  members,
  onProfile,
}: {
  readonly receipts: z.infer<typeof roomReadReceiptSchema>[];
  readonly members: z.infer<typeof roomMemberSchema>[];
  readonly onProfile: (person: z.infer<typeof roomMemberSchema>) => void;
}) {
  const [open, setOpen] = useState(false);
  const readers = members
    .filter((person) => !person.bot && !person.mine)
    .flatMap((person) => {
      const receipt = receipts.find((entry) => entry.userId === person.id);
      return receipt ? [{ person, timestamp: receipt.timestamp }] : [];
    });
  const first = readers[0];
  if (!first) return null;
  const label =
    readers.length === 1
      ? `Visto por ${first.person.name}`
      : `Visto por ${readers.length} pessoas`;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={8}
        onPress={() => {
          setOpen(true);
        }}
        style={styles.receipt}
      >
        <View style={styles.avatars}>
          {readers.slice(0, 3).map(({ person }) => (
            <ConversationAvatar
              key={person.id}
              name={person.name}
              uri={person.avatarUri ?? undefined}
              size={18}
            />
          ))}
        </View>
        <Text style={styles.caption}>{label}</Text>
      </Pressable>
      {open && (
        <CompanionSheet
          title="Visto por"
          maxWidth={560}
          onClose={() => {
            setOpen(false);
          }}
          scrollable={false}
        >
          <Text style={styles.note}>
            Pessoas que compartilharam a leitura até esta mensagem.
          </Text>
          <FlatList
            data={readers}
            keyExtractor={({ person }) => person.id}
            style={styles.list}
            renderItem={({ item: { person, timestamp } }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Ver perfil de ${person.name}`}
                onPress={() => {
                  setOpen(false);
                  onProfile(person);
                }}
                style={styles.person}
              >
                <ConversationAvatar
                  name={person.name}
                  uri={person.avatarUri ?? undefined}
                  size={40}
                />
                <Text style={styles.name}>{person.name}</Text>
                <Text style={styles.caption}>
                  {new Date(timestamp).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </Pressable>
            )}
          />
        </CompanionSheet>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  receipt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
    paddingHorizontal: 4,
  },
  avatars: { flexDirection: "row", gap: 2 },
  caption: { fontSize: 11, color: colors.muted },
  note: { fontSize: 13, color: colors.muted, marginBottom: 12 },
  list: { maxHeight: 460 },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  name: { flex: 1, color: colors.ink, fontSize: 16 },
});

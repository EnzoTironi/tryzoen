import { MessageCircle, Users, X } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { z } from "zod";
import { ConversationAvatar } from "../chats/avatar";
import { IconButton } from "../icon-button";
import { SheetSurface } from "../sheet";
import { colors } from "../theme";
import type { roomMemberSchema } from "./schema";

export function ParticipantProfile({
  person,
  groupName,
  avatarUri,
  onClose,
  onConversation,
}: {
  readonly person: z.infer<typeof roomMemberSchema>;
  readonly groupName: string;
  readonly avatarUri?: string;
  readonly onClose: () => void;
  readonly onConversation: () => void;
}) {
  return (
    <SheetSurface
      title={`Perfil de ${person.name}`}
      onClose={onClose}
      maxWidth={480}
    >
      <View style={styles.toolbar}>
        <IconButton label="Fechar perfil" icon={X} onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <ConversationAvatar
            name={person.name}
            uri={person.bot ? avatarUri : (person.avatarUri ?? undefined)}
            size={112}
          />
          <Text accessibilityRole="header" style={styles.name}>
            {person.name}
          </Text>
          {person.username && (
            <Text selectable style={styles.handle}>
              @{person.username}
            </Text>
          )}
          <Text style={styles.subtitle}>
            {person.bot
              ? "Agente de IA"
              : person.mine
                ? "Seu perfil"
                : "Membro do espaço"}
          </Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>CONVERSA EM COMUM</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Voltar ao grupo ${groupName}`}
            onPress={onConversation}
            style={({ pressed }) => [styles.group, pressed && styles.pressed]}
          >
            <ConversationAvatar name={groupName} group size={44} />
            <View style={styles.copy}>
              <Text style={styles.title}>{groupName}</Text>
              <Text style={styles.subtitle}>Pessoas e Zoen</Text>
            </View>
            <MessageCircle size={22} color={colors.accent} />
          </Pressable>
        </View>
        <View style={styles.about}>
          <Users size={21} color={colors.muted} />
          <Text style={styles.description}>
            {person.bot
              ? "Mencione Zoen no grupo para pedir ajuda. O agente usa o contexto compartilhado desta conversa."
              : "Vocês participam deste espaço. As conversas e memórias pessoais de cada participante continuam privadas."}
          </Text>
        </View>
      </ScrollView>
    </SheetSurface>
  );
}
const styles = StyleSheet.create({
  toolbar: { alignItems: "flex-end", paddingHorizontal: 14 },
  content: { paddingHorizontal: 24, paddingBottom: 32, gap: 28 },
  hero: { alignItems: "center", gap: 12, paddingTop: 8, paddingBottom: 12 },
  name: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: -0.6,
  },
  handle: { color: colors.muted, fontSize: 17, marginTop: -5 },
  subtitle: { color: colors.muted, fontSize: 14 },
  section: { gap: 12 },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.6,
    paddingHorizontal: 8,
  },
  group: {
    backgroundColor: "#f3f3f5",
    borderRadius: 20,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  copy: { flex: 1, gap: 4 },
  title: { color: colors.ink, fontSize: 16, fontWeight: "500" },
  about: { flexDirection: "row", gap: 12, paddingHorizontal: 8 },
  description: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 20 },
  pressed: { opacity: 0.6 },
});

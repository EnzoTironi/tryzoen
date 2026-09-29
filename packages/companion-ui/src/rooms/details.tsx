import { GroupMembership } from "./membership";
import { RoomNotificationSettings } from "./notifications";
import { RenameRoom } from "./rename";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ChevronDown,
  LockKeyhole,
  MessageCircle,
  Sparkles,
  X,
} from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { z } from "zod";
import { ConversationAvatar } from "../chats/avatar";
import { IconButton } from "../icon-button";
import { SheetSurface } from "../sheet";
import { colors } from "../theme";
import type { RoomData, roomPageSchema } from "./schema";

export function RoomDetails({
  data,
  cacheScope,
  page,
  avatarUri,
  onClose,
  onLeft,
  onChanged,
  onConversation,
  onProfile,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly page: z.infer<typeof roomPageSchema>;
  readonly avatarUri?: string;
  readonly onClose: () => void;
  readonly onLeft: () => void;
  readonly onChanged: () => Promise<unknown>;
  readonly onConversation: () => void;
  readonly onProfile: (
    person: z.infer<typeof roomPageSchema>["members"][number]
  ) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [panel, setPanel] = useState<"rename" | "manage" | "leave">();
  const closePanel = () => {
    setPanel(undefined);
  };
  const permissions = useQuery({
    queryKey: ["matrix-room-directory", cacheScope],
    queryFn: () => data.list(),
    retry: false,
  });
  const people = page.members.filter((member) => !member.bot).length;
  const bots = page.members.filter((member) => member.bot).length;
  const members = expanded ? page.members : page.members.slice(0, 6);
  if (panel === "manage" || panel === "leave")
    return (
      <GroupMembership
        data={data}
        cacheScope={cacheScope}
        page={page}
        leaving={panel === "leave"}
        onClose={closePanel}
        onLeft={onLeft}
        onChanged={onChanged}
      />
    );
  if (panel === "rename")
    return (
      <RenameRoom
        data={data}
        cacheScope={cacheScope}
        room={page.room}
        onClose={closePanel}
      />
    );
  return (
    <SheetSurface
      title="Informações do grupo"
      onClose={onClose}
      maxWidth={480}
      panelStyle={styles.panel}
    >
      <View style={styles.toolbar}>
        <Text style={styles.eyebrow}>Informações do grupo</Text>
        <IconButton label="Fechar informações" icon={X} onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.portrait}>
            <ConversationAvatar name={page.room.label} group size={100} />
            {bots > 0 && (
              <View style={styles.agentPortrait}>
                <ConversationAvatar name="Zoen" uri={avatarUri} size={36} />
              </View>
            )}
          </View>
          <Text accessibilityRole="header" style={styles.name}>
            {page.room.label}
          </Text>
          {permissions.data?.mayManage && !permissions.isError && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Editar nome do grupo"
              onPress={() => {
                setPanel("rename");
              }}
              style={{
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: 16,
              }}
            >
              <Text style={styles.actionText}>Editar nome</Text>
            </Pressable>
          )}
          <Text style={styles.subtitle}>
            {people}
            {page.membersTruncated ? "+" : ""}{" "}
            {people === 1 ? "pessoa" : "pessoas"}
            {bots > 0 && ` · ${bots} ${bots === 1 ? "bot" : "bots"}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar à conversa do grupo"
            onPress={onConversation}
            style={({ pressed }) => [
              styles.messageAction,
              pressed && styles.pressed,
            ]}
          >
            <MessageCircle size={20} strokeWidth={1.8} color={colors.accent} />
            <Text style={styles.actionText}>Mensagem</Text>
          </Pressable>
        </View>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Participantes
          </Text>
          {permissions.data?.mayManage && !permissions.isError && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Gerenciar participantes"
              onPress={() => {
                setPanel("manage");
              }}
              style={styles.more}
            >
              <Text style={styles.actionText}>
                Adicionar ou remover pessoas
              </Text>
            </Pressable>
          )}
          <View style={styles.card}>
            {members.map((member, index) => (
              <Pressable
                key={member.id}
                accessibilityRole="button"
                accessibilityLabel={`Perfil de ${member.name}`}
                onPress={() => {
                  onProfile(member);
                }}
                style={styles.member}
              >
                <ConversationAvatar
                  name={member.name}
                  uri={member.bot ? avatarUri : (member.avatarUri ?? undefined)}
                  size={42}
                />
                <View
                  style={[
                    styles.memberCopy,
                    index < members.length - 1 && styles.divider,
                  ]}
                >
                  <View style={styles.memberHeading}>
                    <Text numberOfLines={1} style={styles.memberName}>
                      {member.name}
                    </Text>
                    {member.bot && <Text style={styles.badge}>IA</Text>}
                  </View>
                  <Text style={styles.memberCaption}>
                    {member.bot
                      ? "Seu agente nesta conversa"
                      : member.mine
                        ? "Você"
                        : "Membro do espaço"}
                  </Text>
                </View>
              </Pressable>
            ))}
            {page.members.length > 6 && !expanded && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setExpanded(true);
                }}
                style={styles.more}
              >
                <Text style={styles.actionText}>
                  Ver todos os participantes
                </Text>
                <ChevronDown size={16} color={colors.accent} />
              </Pressable>
            )}
          </View>
          {page.membersTruncated && (
            <Text style={styles.footnote}>
              Mostrando os primeiros 100 participantes.
            </Text>
          )}
        </View>
        <RoomNotificationSettings
          data={data}
          cacheScope={cacheScope}
          roomId={page.room.id}
        />
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Sobre esta conversa
          </Text>
          <View style={styles.card}>
            <View style={styles.aboutRow}>
              <View style={styles.aboutIcon}>
                <Sparkles size={20} color={colors.accent} strokeWidth={1.7} />
              </View>
              <View style={[styles.aboutCopy, styles.divider]}>
                <Text style={styles.aboutTitle}>Zoen faz parte do grupo</Text>
                <Text style={styles.aboutDescription}>
                  Mencione Zoen para pedir ajuda na conversa.
                </Text>
              </View>
            </View>
            <View style={styles.aboutRow}>
              <View style={[styles.aboutIcon, styles.privacyIcon]}>
                <LockKeyhole size={20} color="#487969" strokeWidth={1.7} />
              </View>
              <View style={styles.aboutCopy}>
                <Text style={styles.aboutTitle}>
                  Suas memórias continuam privadas
                </Text>
                <Text style={styles.aboutDescription}>
                  Participar do grupo não compartilha suas memórias pessoais.
                </Text>
              </View>
            </View>
          </View>
          <Text style={styles.footnote}>
            Uma conversa compartilhada com os membros deste espaço.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sair do grupo"
          onPress={() => {
            setPanel("leave");
          }}
          style={styles.messageAction}
        >
          <Text style={[styles.actionText, { color: colors.danger }]}>
            Sair do grupo
          </Text>
        </Pressable>
      </ScrollView>
    </SheetSurface>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#f5f5f7" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 24,
    paddingRight: 12,
  },
  eyebrow: { color: colors.muted, fontSize: 13, fontWeight: "500" },
  content: { paddingHorizontal: 20, paddingBottom: 28, gap: 24 },
  hero: { alignItems: "center", paddingTop: 8, gap: 8, paddingHorizontal: 8 },
  portrait: {
    marginBottom: 8,
    borderWidth: 4,
    borderColor: colors.surface,
    borderRadius: 56,
    boxShadow: "0 4px 18px rgba(42,64,54,0.08)",
  },
  agentPortrait: {
    position: "absolute",
    bottom: -4,
    right: -8,
    borderWidth: 3,
    borderColor: "#f5f5f7",
    borderRadius: 24,
  },
  name: {
    fontSize: 25,
    fontWeight: "600",
    letterSpacing: -0.6,
    color: colors.ink,
    textAlign: "center",
    lineHeight: 31,
  },
  subtitle: { color: colors.muted, fontSize: 14 },
  messageAction: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: 28,
    minHeight: 46,
    marginTop: 10,
  },
  actionText: { color: colors.accent, fontSize: 14, fontWeight: "500" },
  pressed: { opacity: 0.6 },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.muted,
    paddingHorizontal: 14,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    overflow: "hidden",
  },
  member: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    gap: 12,
  },
  memberCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    gap: 4,
    minHeight: 70,
    paddingVertical: 12,
    paddingRight: 14,
  },
  memberHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  memberName: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "500",
    color: colors.ink,
  },
  memberCaption: { fontSize: 12, color: colors.muted },
  badge: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.accent,
    backgroundColor: "#e9f2ff",
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: "hidden",
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ebebee",
  },
  more: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  aboutRow: { flexDirection: "row", paddingLeft: 14, gap: 12 },
  aboutIcon: {
    width: 32,
    height: 32,
    marginTop: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#edf3fd",
  },
  privacyIcon: { backgroundColor: "#edf4ef" },
  aboutCopy: { flex: 1, gap: 4, paddingVertical: 16, paddingRight: 16 },
  aboutTitle: { fontSize: 14, fontWeight: "500", color: colors.ink },
  aboutDescription: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  footnote: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 14,
  },
});

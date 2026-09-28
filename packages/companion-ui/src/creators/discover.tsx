import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ArrowUpRight, Search, Sparkles } from "lucide-react-native";
import { CompanionPage } from "../page";
import { ActionButton } from "../button";
import { ConversationAvatar } from "../chats/avatar";
import { colors } from "../theme";
import type { CreatorStudioData } from "./studio";

const creatorInterviewPrompt =
  "Quero criar meu próprio bot. Me entreviste para entender quem quero ajudar, meu conteúdo, meu jeito de pensar e os limites do bot. Comece com poucas perguntas. Salve um rascunho privado conforme conversamos. Vamos revisar fontes e exemplos antes de aprovar qualquer publicação.";

export function DiscoverBots({
  data,
  cacheScope,
  onPrompt,
  avatarUri,
}: {
  readonly data: Pick<CreatorStudioData, "pilots" | "list">;
  readonly cacheScope: string;
  readonly onPrompt: (prompt: string) => void;
  readonly avatarUri?: string;
}) {
  const [search, setSearch] = useState("");
  const pilots = useQuery({
    queryKey: ["creator-pilots", cacheScope],
    queryFn: () => data.pilots(),
  });
  const drafts = useQuery({
    queryKey: ["creator-drafts", cacheScope],
    queryFn: () => data.list(),
  });
  const match = (title: string) =>
    title.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  const available =
    pilots.data?.filter(
      (pilot) =>
        pilot.status === "active" &&
        !pilot.isCreator &&
        match(`${pilot.title} ${pilot.username ?? ""}`)
    ) ?? [];
  return (
    <CompanionPage
      title="Descobrir"
      loading={pilots.isPending || drafts.isPending}
      error={
        pilots.error || drafts.error
          ? "Não foi possível carregar seus bots."
          : undefined
      }
      onRetry={() => {
        void pilots.refetch();
        void drafts.refetch();
      }}
    >
      <Text style={styles.intro}>
        Uma boa conversa pode começar com a pessoa certa. Ou com o bot certo.
      </Text>
      <View style={styles.search}>
        <Search size={20} color={colors.muted} />
        <TextInput
          accessibilityLabel="Buscar bots"
          placeholder="Buscar bots"
          value={search}
          onChangeText={setSearch}
          maxLength={100}
          style={styles.input}
        />
      </View>
      <Text style={styles.section}>Para conversar</Text>
      <View style={styles.cards}>
        {match("Zoen") && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onPrompt(
                "Vamos conversar. Me ajude a decidir no que focar hoje."
              );
            }}
            style={styles.card}
          >
            <ConversationAvatar name="Zoen" uri={avatarUri} size={56} />
            <Text style={styles.title}>Zoen</Text>
            <Text style={styles.copy}>
              Seu agente pessoal, com suas ideias, metas e memória.
            </Text>
            <Text style={styles.link}>Conversar ↗</Text>
          </Pressable>
        )}
        {available.map((pilot) => (
          <Pressable
            key={pilot.id}
            accessibilityRole="button"
            onPress={() => {
              onPrompt(
                `Quero conversar usando o especialista ${pilot.title}, de ${pilot.creatorName}. Use os ensinamentos compartilhados comigo como referência nesta conversa privada. Não compartilhe a conversa com o criador.`
              );
            }}
            style={styles.card}
          >
            <ConversationAvatar name={pilot.title} size={56} />
            <Text style={styles.title}>{pilot.title} · IA</Text>
            {pilot.username && (
              <Text style={styles.byline}>@{pilot.username}</Text>
            )}
            <Text style={styles.copy}>{pilot.description}</Text>
            <Text style={styles.byline}>
              Por {pilot.creatorName} · acesso por convite
            </Text>
            <Text style={styles.link}>Conversar ↗</Text>
          </Pressable>
        ))}
      </View>
      {!available.length && (
        <Text style={styles.note}>
          Bots compartilhados com você aparecerão aqui após aceitar o convite.
        </Text>
      )}
      <View style={styles.create}>
        <Sparkles size={28} color={colors.accent} />
        <View style={styles.createCopy}>
          <Text style={styles.title}>
            Seu conhecimento pode virar uma conversa.
          </Text>
          <Text style={styles.copy}>
            Conte sua ideia. O Zoen te entrevista e prepara seu bot com você.
          </Text>
        </View>
        <ActionButton
          onPress={() => {
            onPrompt(creatorInterviewPrompt);
          }}
        >
          Criar meu bot
        </ActionButton>
      </View>
      {(drafts.data?.filter((draft) => !draft.archivedAt && match(draft.title))
        .length ?? 0) > 0 && (
        <>
          <Text style={styles.section}>Seus bots em construção</Text>
          {drafts.data
            ?.filter((draft) => !draft.archivedAt && match(draft.title))
            .map((draft) => (
              <Pressable
                key={draft.id}
                accessibilityRole="button"
                onPress={() => {
                  onPrompt(
                    `Vamos continuar criando meu bot ${draft.title}. Retome meu rascunho privado e me entreviste sobre o próximo ponto que falta e preserve o que já construímos.`
                  );
                }}
                style={styles.draft}
              >
                <ConversationAvatar name={draft.title} />
                <View style={styles.createCopy}>
                  <Text style={styles.title}>{draft.title}</Text>
                  <Text numberOfLines={1} style={styles.copy}>
                    {draft.description || "Continuar a entrevista"}
                  </Text>
                </View>
                <ArrowUpRight size={20} color={colors.muted} />
              </Pressable>
            ))}
        </>
      )}
    </CompanionPage>
  );
}
const styles = StyleSheet.create({
  intro: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 28,
    maxWidth: 620,
    marginBottom: 28,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    backgroundColor: "#f2f2f4",
    paddingHorizontal: 16,
    maxWidth: 620,
    minHeight: 48,
  },
  input: { flex: 1, outlineWidth: 0, color: colors.ink, fontSize: 16 },
  section: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.ink,
    marginTop: 36,
    marginBottom: 18,
  },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  card: {
    width: 250,
    flexGrow: 1,
    maxWidth: 340,
    borderWidth: 1,
    borderColor: "#e9e9ee",
    borderRadius: 24,
    padding: 24,
    gap: 14,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 17, fontWeight: "600", color: colors.ink },
  copy: { fontSize: 14, lineHeight: 22, color: colors.muted },
  byline: { fontSize: 12, color: colors.muted },
  link: { fontSize: 14, color: colors.accent, marginTop: 4 },
  note: { fontSize: 13, color: colors.muted, lineHeight: 21, marginTop: 16 },
  create: {
    marginTop: 36,
    padding: 24,
    borderRadius: 24,
    backgroundColor: "#edf4fd",
    gap: 18,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  createCopy: { flex: 1, gap: 6, minWidth: 160 },
  draft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#ededf0",
  },
});

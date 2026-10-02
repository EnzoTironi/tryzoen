import { useI18n, Translated } from "./../i18n";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ArrowUpRight, Search, Sparkles } from "lucide-react-native";
import { CompanionPage } from "../page";
import { ActionButton } from "../button";
import { ConversationAvatar } from "../chats/avatar";
import { systemFont, useColors } from "../theme";
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
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
      title={t("Descobrir")}
      loading={pilots.isPending || drafts.isPending}
      error={
        pilots.error || drafts.error
          ? t("Não foi possível carregar seus bots.")
          : undefined
      }
      onRetry={() => {
        void pilots.refetch();
        void drafts.refetch();
      }}
    >
      <Text style={styles.intro}>
        {t(
          "Uma boa conversa pode começar com a pessoa certa. Ou com o bot certo."
        )}
      </Text>
      <View style={styles.search}>
        <Search size={20} color={colors.muted} />
        <TextInput
          accessibilityLabel={t("Buscar bots")}
          placeholder={t("Buscar bots")}
          value={search}
          onChangeText={setSearch}
          maxLength={100}
          style={styles.input}
        />
      </View>
      <Text style={styles.section}>{t("Para conversar")}</Text>
      <View style={styles.cards}>
        {match(t("Zoen")) && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onPrompt(
                t("Vamos conversar. Me ajude a decidir no que focar hoje.")
              );
            }}
            style={styles.card}
          >
            <ConversationAvatar name="Zoen" uri={avatarUri} size={56} />
            <Text style={styles.title}>{t("Zoen")}</Text>
            <Text style={styles.copy}>
              {t("Seu agente pessoal, com suas ideias, metas e memória.")}
            </Text>
            <Text style={styles.link}>{t("Conversar ↗")}</Text>
          </Pressable>
        )}
        {available.map((pilot) => (
          <Pressable
            key={pilot.id}
            accessibilityRole="button"
            onPress={() => {
              onPrompt(
                t(
                  "Quero conversar usando o especialista {value1}, de {value2}. Use os ensinamentos compartilhados comigo como referência nesta conversa privada. Não compartilhe a conversa com o criador.",
                  { value1: pilot.title, value2: pilot.creatorName }
                )
              );
            }}
            style={styles.card}
          >
            <ConversationAvatar name={pilot.title} size={56} />
            <Text style={styles.title}>
              <Translated
                message="{value1} · IA"
                values={{ value1: pilot.title }}
              />
            </Text>
            {pilot.username && (
              <Text style={styles.byline}>@{pilot.username}</Text>
            )}
            <Text style={styles.copy}>{pilot.description}</Text>
            <Text style={styles.byline}>
              <Translated
                message="Por {value1} · acesso por convite"
                values={{ value1: pilot.creatorName }}
              />
            </Text>
            <Text style={styles.link}>{t("Conversar ↗")}</Text>
          </Pressable>
        ))}
      </View>
      {!available.length && (
        <Text style={styles.note}>
          {t(
            "Bots compartilhados com você aparecerão aqui após aceitar o convite."
          )}
        </Text>
      )}
      <View style={styles.create}>
        <Sparkles size={28} color={colors.accent} />
        <View style={styles.createCopy}>
          <Text style={styles.title}>
            {t("Seu conhecimento pode virar uma conversa.")}
          </Text>
          <Text style={styles.copy}>
            {t(
              "Conte sua ideia. O Zoen te entrevista e prepara seu bot com você."
            )}
          </Text>
        </View>
        <ActionButton
          onPress={() => {
            onPrompt(creatorInterviewPrompt);
          }}
        >
          {t("Criar meu bot")}
        </ActionButton>
      </View>
      {(drafts.data?.filter((draft) => !draft.archivedAt && match(draft.title))
        .length ?? 0) > 0 && (
        <>
          <Text style={styles.section}>{t("Seus bots em construção")}</Text>
          {drafts.data
            ?.filter((draft) => !draft.archivedAt && match(draft.title))
            .map((draft) => (
              <Pressable
                key={draft.id}
                accessibilityRole="button"
                onPress={() => {
                  onPrompt(
                    t(
                      "Vamos continuar criando meu bot {value1}. Retome meu rascunho privado e me entreviste sobre o próximo ponto que falta e preserve o que já construímos.",
                      { value1: draft.title }
                    )
                  );
                }}
                style={styles.draft}
              >
                <ConversationAvatar name={draft.title} />
                <View style={styles.createCopy}>
                  <Text style={styles.title}>{draft.title}</Text>
                  <Text numberOfLines={1} style={styles.copy}>
                    {draft.description || t("Continuar a entrevista")}
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
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    intro: {
      fontFamily: systemFont,
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
    input: {
      fontFamily: systemFont,
      flex: 1,
      outlineWidth: 0,
      color: colors.ink,
      fontSize: 16,
    },
    section: {
      fontFamily: systemFont,
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
    title: {
      fontFamily: systemFont,
      fontSize: 17,
      fontWeight: "600",
      color: colors.ink,
    },
    copy: {
      fontFamily: systemFont,
      fontSize: 14,
      lineHeight: 22,
      color: colors.muted,
    },
    byline: { fontFamily: systemFont, fontSize: 12, color: colors.muted },
    link: {
      fontFamily: systemFont,
      fontSize: 14,
      color: colors.accent,
      marginTop: 4,
    },
    note: {
      fontFamily: systemFont,
      fontSize: 13,
      color: colors.muted,
      lineHeight: 21,
      marginTop: 16,
    },
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
}

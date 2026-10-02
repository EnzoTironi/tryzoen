import { useMemo, useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MessageCircle, Search, Users } from "lucide-react-native";
import { CompanionSheet } from "../sheet";
import { ConversationAvatar } from "./avatar";
import { systemFont, useColors } from "../theme";
import { useDirectConversation } from "../rooms/direct";
import type { RoomData } from "../rooms/schema";

export function CreateConversation({
  data,
  cacheScope,
  configured,
  mayManage,
  avatarUri,
  onClose,
  onAgent,
  onGroup,
  onOpened,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly configured: boolean;
  readonly mayManage: boolean;
  readonly avatarUri?: string;
  readonly onClose: () => void;
  readonly onAgent: () => void;
  readonly onGroup: () => void;
  readonly onOpened: (id: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [search, setSearch] = useState("");
  const needle = useDeferredValue(search.trim());
  const people = useQuery({
    queryKey: ["direct-people", cacheScope, needle],
    queryFn: () => data.people({ query: needle }),
    enabled: configured && needle.length >= 2,
    staleTime: 10_000,
  });
  const open = useDirectConversation(data, cacheScope, onOpened);
  return (
    <CompanionSheet title="Nova conversa" onClose={onClose}>
      <View style={styles.search}>
        <Search size={18} color={colors.muted} />
        <TextInput
          accessibilityLabel="Buscar pessoas por nome ou username"
          placeholder="Nome ou @username"
          value={search}
          onChangeText={setSearch}
          maxLength={80}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
      </View>
      {!needle && (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={onAgent}
            style={styles.row}
            disabled={open.isPending}
          >
            <ConversationAvatar name="Zoen" uri={avatarUri} size={44} />
            <View style={styles.copy}>
              <Text style={styles.name}>Zoen</Text>
              <Text style={styles.caption}>Uma conversa com seu agente</Text>
            </View>
            <MessageCircle size={22} color={colors.accent} />
          </Pressable>
          {configured && mayManage && (
            <Pressable
              accessibilityRole="button"
              onPress={onGroup}
              style={styles.row}
              disabled={open.isPending}
            >
              <View style={styles.icon}>
                <Users size={22} color={colors.accent} />
              </View>
              <Text style={styles.name}>Novo grupo</Text>
            </Pressable>
          )}
        </View>
      )}
      <Text style={styles.caption}>
        {configured
          ? "Busque pessoas deste espaço para conversar a dois."
          : "As conversas entre pessoas ainda não estão disponíveis neste ambiente."}
      </Text>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.results}>
        {needle.length >= 2 && people.isFetching && (
          <ActivityIndicator
            accessibilityLabel="Buscando pessoas"
            color={colors.muted}
          />
        )}
        {!people.isError &&
          people.data?.map((person) => (
            <Pressable
              key={person.username}
              accessibilityRole="button"
              accessibilityLabel={`Conversar com ${person.name}, @${person.username}`}
              disabled={open.isPending}
              onPress={() => {
                open.mutate(person.username);
              }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <ConversationAvatar
                name={person.name}
                uri={person.avatarUri ?? undefined}
                size={48}
              />
              <View style={styles.copy}>
                <Text style={styles.name}>{person.name}</Text>
                <Text style={styles.caption}>@{person.username}</Text>
              </View>
              {open.isPending && open.variables === person.username ? (
                <ActivityIndicator />
              ) : (
                <MessageCircle size={22} color={colors.accent} />
              )}
            </Pressable>
          ))}
        {needle.length >= 2 && people.isSuccess && !people.data.length && (
          <Text style={styles.caption}>
            Nenhuma pessoa encontrada neste espaço.
          </Text>
        )}
        {people.isError && (
          <Text accessibilityRole="alert" style={styles.error}>
            Não foi possível buscar pessoas. Tente outra vez.
          </Text>
        )}
        {open.isError && (
          <Text accessibilityRole="alert" style={styles.error}>
            Não foi possível abrir a conversa. Toque na pessoa para tentar
            novamente.
          </Text>
        )}
      </ScrollView>
    </CompanionSheet>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.wash,
      borderRadius: 16,
      paddingHorizontal: 14,
    },
    input: {
      fontFamily: systemFont,
      flex: 1,
      minHeight: 48,
      fontSize: 16,
      color: colors.ink,
    },
    actions: {
      borderRadius: 20,
      backgroundColor: colors.wash,
      overflow: "hidden",
    },
    row: {
      minHeight: 76,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    icon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#e8f1ff",
    },
    copy: { flex: 1, minWidth: 0, gap: 4 },
    name: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 16,
      fontWeight: "600",
    },
    caption: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 13,
      lineHeight: 20,
    },
    results: { maxHeight: 340 },
    pressed: { opacity: 0.65 },
    error: {
      fontFamily: systemFont,
      color: colors.danger,
      fontSize: 14,
      padding: 12,
    },
  });
}

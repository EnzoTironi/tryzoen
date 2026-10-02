import { useMemo, createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { systemFont, useColors } from "../theme";
import { quickReactions } from "../reactions/quick";

export interface GesturePreferenceStorage {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
}
const preferenceSchema = z
  .string()
  .refine((value) => quickReactions.some((entry) => entry.emoji === value))
  .nullable();
const preferenceKey = ["device-message-gesture"];
const GesturePreferenceContext = createContext<
  ReturnType<typeof useGesturePreference> | undefined
>(undefined);

function useGesturePreference(storage: GesturePreferenceStorage) {
  const client = useQueryClient();
  const preference = useQuery({
    queryKey: preferenceKey,
    queryFn: async () => {
      const saved = await storage.read();
      return saved === null ? "❤️" : preferenceSchema.parse(JSON.parse(saved));
    },
    staleTime: Infinity,
    gcTime: Infinity,
    networkMode: "always",
    retry: false,
  });
  const save = useMutation({
    networkMode: "always",
    mutationFn: (emoji: string | null) =>
      storage.write(JSON.stringify(preferenceSchema.parse(emoji))),
    onMutate: async (emoji) => {
      await client.cancelQueries({ queryKey: preferenceKey });
      const previous =
        client.getQueryData<string | null>(preferenceKey) ?? null;
      client.setQueryData(preferenceKey, emoji);
      return { previous };
    },
    onError: (_error, _emoji, context) => {
      if (context) client.setQueryData(preferenceKey, context.previous);
    },
  });
  return { preference, save };
}

export function GesturePreferenceProvider({
  storage,
  children,
}: {
  readonly storage: GesturePreferenceStorage;
  readonly children: ReactNode;
}) {
  const value = useGesturePreference(storage);
  return (
    <GesturePreferenceContext value={value}>
      {children}
    </GesturePreferenceContext>
  );
}

export function useQuickReaction() {
  const value = useContext(GesturePreferenceContext);
  return value?.preference.data ?? undefined;
}

export function MessageGestureSettings() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const value = useContext(GesturePreferenceContext);
  if (!value) return null;
  const { preference, save } = value;
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        Gestos das mensagens
      </Text>
      <Text style={styles.description}>
        Toque duas vezes para reagir. A preferência vale neste aparelho. No
        computador, o duplo clique continua selecionando texto.
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Reação do duplo toque"
        style={styles.choices}
      >
        {[...quickReactions.map((item) => item.emoji), null].map((emoji) => (
          <Pressable
            key={emoji ?? "off"}
            accessibilityRole="radio"
            accessibilityLabel={
              emoji ? `Reagir com ${emoji}` : "Desativar duplo toque"
            }
            aria-checked={preference.data === emoji}
            aria-disabled={preference.isPending || save.isPending}
            disabled={preference.isPending || save.isPending}
            onPress={() => {
              save.mutate(emoji);
            }}
            style={[
              styles.choice,
              preference.data === emoji && styles.selected,
            ]}
          >
            <Text style={emoji ? styles.emoji : styles.description}>
              {emoji ?? "Não"}
            </Text>
          </Pressable>
        ))}
      </View>
      {(preference.isError || save.isError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          Não foi possível salvar a preferência. Tente escolher novamente.
        </Text>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    section: { gap: 12, paddingVertical: 16 },
    title: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 17,
      fontWeight: "600",
    },
    description: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 14,
      lineHeight: 20,
    },
    choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    choice: {
      minWidth: 44,
      height: 44,
      paddingHorizontal: 8,
      borderRadius: 14,
      backgroundColor: colors.wash,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "transparent",
    },
    selected: { borderColor: colors.ink },
    emoji: { fontFamily: systemFont, fontSize: 23 },
    error: { fontFamily: systemFont, color: colors.danger, fontSize: 14 },
  });
}

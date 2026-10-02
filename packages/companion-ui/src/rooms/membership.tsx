import { useI18n } from "./../i18n";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ChevronRight, UserMinus, UserPlus } from "lucide-react-native";
import type { z } from "zod";
import { ActionButton } from "../button";
import { ConversationAvatar } from "../chats/avatar";
import { CompanionSheet } from "../sheet";
import { usePageStyles } from "../page";
import { systemFont, useColors } from "../theme";
import type {
  RoomData,
  roomMembershipChangeSchema,
  roomPageSchema,
} from "./schema";

type MembershipSelection = z.infer<typeof roomMembershipChangeSchema> & {
  name: string;
};
const labels = {
  leave: "Sair do grupo",
  remove: "Remover participante",
  add: "Adicionar ao grupo",
};
const explanations = {
  leave:
    "Você deixará de acessar esta conversa e seus arquivos. Um administrador do espaço poderá adicionar você novamente. As mensagens enviadas permanecem no grupo.",
  remove:
    "Esta pessoa deixará de acessar o grupo e seus arquivos. As mensagens já enviadas serão preservadas.",
  add: "Esta pessoa já pertence ao espaço. Ela receberá acesso ao grupo a partir da entrada; suas memórias pessoais continuam privadas.",
};

export function GroupMembership({
  data,
  cacheScope,
  page,
  leaving,
  onClose,
  onLeft,
  onChanged,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly page: z.infer<typeof roomPageSchema>;
  readonly leaving: boolean;
  readonly onClose: () => void;
  readonly onLeft: () => void;
  readonly onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const client = useQueryClient();
  const [selection, setSelection] = useState<MembershipSelection | undefined>(
    leaving
      ? { id: page.room.id, action: "leave", name: page.room.label }
      : undefined
  );
  const change = useMutation({
    mutationFn: (input: z.infer<typeof roomMembershipChangeSchema>) =>
      data.changeMembership(input),
    onSuccess: async (_result, input) => {
      const filter = {
        predicate: (query: { queryKey: readonly unknown[] }) =>
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("matrix-") &&
          query.queryKey[0] !== "matrix-draft" &&
          query.queryKey[1] === cacheScope &&
          query.queryKey[2] === page.room.id,
      };
      await client.cancelQueries(filter);
      if (input.action === "leave") {
        onLeft();
        client.removeQueries(filter);
      } else {
        await client.invalidateQueries({ ...filter, refetchType: "none" });
        await onChanged();
        setSelection(undefined);
      }
      void client.invalidateQueries({
        queryKey: ["conversation-inbox", cacheScope],
      });
      void client.invalidateQueries({
        queryKey: ["matrix-room-directory", cacheScope],
      });
    },
  });
  const close = () => {
    if (!change.isPending) onClose();
  };
  return (
    <CompanionSheet
      title={selection ? t(labels[selection.action]) : t("Participantes")}
      onClose={close}
    >
      {selection ? (
        <GroupMemberConfirmation
          selection={selection}
          pending={change.isPending}
          onConfirm={() => {
            change.mutate(selection);
          }}
          onCancel={() => {
            if (leaving) close();
            else {
              setSelection(undefined);
              change.reset();
            }
          }}
        />
      ) : (
        <GroupPeople
          data={data}
          cacheScope={cacheScope}
          page={page}
          onSelect={(selected) => {
            change.reset();
            setSelection(selected);
          }}
        />
      )}
      {change.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(
            "Não foi possível confirmar a alteração. Confira sua conexão e suas permissões antes de tentar novamente."
          )}
        </Text>
      )}
      {change.data?.nativePending && (
        <Text accessibilityLiveRegion="polite" style={pageStyles.copy}>
          {t(
            "O acesso foi removido. A atualização do serviço de mensagens será tentada novamente automaticamente."
          )}
        </Text>
      )}
    </CompanionSheet>
  );
}

function GroupMemberConfirmation({
  selection,
  pending,
  onConfirm,
  onCancel,
}: {
  readonly selection: MembershipSelection;
  readonly pending: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  return (
    <>
      <View style={styles.identity}>
        <ConversationAvatar
          name={selection.name}
          group={selection.action === "leave"}
          size={72}
        />
        <Text style={styles.name}>{selection.name}</Text>
      </View>
      <Text style={pageStyles.copy}>{t(explanations[selection.action])}</Text>
      <ActionButton disabled={pending} onPress={onConfirm}>
        {pending ? t("Atualizando…") : t(labels[selection.action])}
      </ActionButton>
      <ActionButton quiet disabled={pending} onPress={onCancel}>
        {t("Cancelar")}
      </ActionButton>
    </>
  );
}

function GroupPeople({
  data,
  cacheScope,
  page,
  onSelect,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly page: z.infer<typeof roomPageSchema>;
  readonly onSelect: (selection: MembershipSelection) => void;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const [search, setSearch] = useState("");
  const people = useQuery({
    queryKey: ["matrix-people", cacheScope, search.trim()],
    queryFn: () => data.people({ query: search.trim() }),
    enabled: search.trim().length >= 2,
    retry: false,
  });
  const members = page.members.filter((member) => !member.bot);
  const results =
    search.trim().length >= 2
      ? people.data?.filter(
          (person) =>
            !members.some((member) => member.username === person.username)
        )
      : [];
  return (
    <>
      <Text style={pageStyles.copy}>
        {t(
          "Pessoas deste espaço. Administradores são gerenciados nas configurações do espaço."
        )}
      </Text>
      <TextInput
        accessibilityLabel={t("Buscar pessoas para adicionar")}
        placeholder={t("Nome ou @username")}
        value={search}
        onChangeText={setSearch}
        style={pageStyles.field}
        autoCapitalize="none"
      />
      {people.isFetching && (
        <ActivityIndicator accessibilityLabel={t("Buscando pessoas")} />
      )}
      {people.isError && (
        <ActionButton
          quiet
          onPress={() => {
            void people.refetch();
          }}
        >
          {t("Tentar buscar novamente")}
        </ActionButton>
      )}
      {!!results?.length && (
        <Text style={styles.label}>{t("Adicionar ao grupo")}</Text>
      )}
      {results?.map((person) => (
        <Pressable
          key={person.username}
          accessibilityRole="button"
          accessibilityLabel={t("Adicionar {value1}", { value1: person.name })}
          onPress={() => {
            onSelect({
              id: page.room.id,
              action: "add",
              username: person.username,
              name: person.name,
            });
          }}
          style={styles.row}
        >
          <ConversationAvatar
            name={person.name}
            uri={person.avatarUri ?? undefined}
            size={42}
          />
          <View style={styles.copy}>
            <Text style={styles.name}>{person.name}</Text>
            <Text style={pageStyles.copy}>@{person.username}</Text>
          </View>
          <UserPlus size={20} color={colors.accent} />
        </Pressable>
      ))}
      {search.trim().length >= 2 && people.isSuccess && !results?.length && (
        <Text style={pageStyles.copy}>
          {t("Nenhuma outra pessoa encontrada neste espaço.")}
        </Text>
      )}
      <Text style={styles.label}>{t("No grupo")}</Text>
      {members.map((member) => (
        <View key={member.id} style={styles.row}>
          <ConversationAvatar
            name={member.name}
            uri={member.avatarUri ?? undefined}
            size={42}
          />
          <View style={styles.copy}>
            <Text style={styles.name}>{member.name}</Text>
            <Text style={pageStyles.copy}>
              {member.mine
                ? t("Você")
                : member.mayRemove
                  ? t("Participante")
                  : t("Administrador do espaço")}
            </Text>
          </View>
          {member.username && member.mayRemove && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Remover {value1}", {
                value1: member.name,
              })}
              style={styles.action}
              onPress={() => {
                onSelect({
                  id: page.room.id,
                  action: "remove",
                  username: member.username ?? "",
                  name: member.name,
                });
              }}
            >
              <UserMinus size={20} color={colors.danger} />
              <ChevronRight size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>
      ))}
      {page.membersTruncated && (
        <Text style={pageStyles.copy}>
          {t("Mostrando os primeiros 100 participantes.")}
        </Text>
      )}
    </>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    identity: { alignItems: "center", gap: 12, paddingVertical: 12 },
    name: {
      fontFamily: systemFont,
      fontSize: 16,
      fontWeight: "600",
      color: colors.ink,
    },
    label: {
      fontFamily: systemFont,
      fontSize: 13,
      fontWeight: "600",
      color: colors.muted,
      marginTop: 10,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 64,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    copy: { flex: 1, gap: 3 },
    action: {
      minHeight: 44,
      minWidth: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    error: { fontFamily: systemFont, color: colors.danger, fontSize: 14 },
  });
}

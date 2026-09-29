import { useState } from "react";
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
import { pageStyles } from "../page";
import { colors } from "../theme";
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
      title={selection ? labels[selection.action] : "Participantes"}
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
          Não foi possível confirmar a alteração. Confira sua conexão e suas
          permissões antes de tentar novamente.
        </Text>
      )}
      {change.data?.nativePending && (
        <Text accessibilityLiveRegion="polite" style={pageStyles.copy}>
          O acesso foi removido. A atualização do serviço de mensagens será
          tentada novamente automaticamente.
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
      <Text style={pageStyles.copy}>{explanations[selection.action]}</Text>
      <ActionButton disabled={pending} onPress={onConfirm}>
        {pending ? "Atualizando…" : labels[selection.action]}
      </ActionButton>
      <ActionButton quiet disabled={pending} onPress={onCancel}>
        Cancelar
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
        Pessoas deste espaço. Administradores são gerenciados nas configurações
        do espaço.
      </Text>
      <TextInput
        accessibilityLabel="Buscar pessoas para adicionar"
        placeholder="Nome ou @username"
        value={search}
        onChangeText={setSearch}
        style={pageStyles.field}
        autoCapitalize="none"
      />
      {people.isFetching && (
        <ActivityIndicator accessibilityLabel="Buscando pessoas" />
      )}
      {people.isError && (
        <ActionButton
          quiet
          onPress={() => {
            void people.refetch();
          }}
        >
          Tentar buscar novamente
        </ActionButton>
      )}
      {!!results?.length && (
        <Text style={styles.label}>Adicionar ao grupo</Text>
      )}
      {results?.map((person) => (
        <Pressable
          key={person.username}
          accessibilityRole="button"
          accessibilityLabel={`Adicionar ${person.name}`}
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
          Nenhuma outra pessoa encontrada neste espaço.
        </Text>
      )}
      <Text style={styles.label}>No grupo</Text>
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
                ? "Você"
                : member.mayRemove
                  ? "Participante"
                  : "Administrador do espaço"}
            </Text>
          </View>
          {member.username && member.mayRemove && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remover ${member.name}`}
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
          Mostrando os primeiros 100 participantes.
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: "center", gap: 12, paddingVertical: 12 },
  name: { fontSize: 16, fontWeight: "600", color: colors.ink },
  label: {
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
  error: { color: colors.danger, fontSize: 14 },
});

import { BookmarkX, ChevronRight } from "lucide-react-native";
import { IconButton } from "../icon-button";
import { ConversationAvatar } from "../chats/avatar";
import { ClearUnavailableSaved } from "./clear-saved";
import { useState, type ComponentProps } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  FlatList,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import type { z } from "zod";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { AssistantMarkdown } from "../markdown";
import { colors } from "../theme";
import { RoomAttachment } from "./attachment";
import { SaveRoomMessage } from "./save-message";
import { ParticipantProfile } from "./profile";
import type {
  RoomData,
  savedMessagesPageSchema,
  roomMediaReadSchema,
  roomMessageSchema,
} from "./schema";

export function SavedRoomMessages({
  data,
  cacheScope,
  onClose,
  onOpenRoom,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly onClose: () => void;
  readonly onOpenRoom: (id: string) => void;
}) {
  const client = useQueryClient();
  const refresh = () =>
    client.resetQueries({
      queryKey: ["matrix-saved", cacheScope],
      exact: true,
    });
  const [selected, setSelected] =
    useState<z.infer<typeof roomMediaReadSchema>>();
  const [removing, setRemoving] =
    useState<z.infer<typeof roomMediaReadSchema>>();
  const result = useInfiniteQuery({
    queryKey: ["matrix-saved", cacheScope],
    initialPageParam: null as z.infer<
      typeof savedMessagesPageSchema
    >["nextCursor"],
    queryFn: ({ pageParam }) => data.savedMessages({ cursor: pageParam }),
    getNextPageParam: (page) => (page.reset ? undefined : page.nextCursor),
    staleTime: 0,
    retry: 1,
  });
  const pages = result.data?.pages ?? [];
  const reset = pages.some((page) => page.reset);
  const items =
    result.isError || reset ? [] : pages.flatMap((page) => page.items);
  if (selected)
    return (
      <SavedMessageContext
        data={data}
        cacheScope={cacheScope}
        reference={selected}
        onClose={() => {
          setSelected(undefined);
        }}
        onOpenRoom={(id) => {
          onOpenRoom(id);
          onClose();
        }}
      />
    );
  return (
    <CompanionSheet title="Mensagens salvas" onClose={onClose}>
      <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 16 }}>
        Só você · até 100 mensagens. As salvas deste espaço aparecem aqui.
      </Text>
      {(result.isError || reset) && (
        <>
          <Text accessibilityRole="alert">
            {reset
              ? "A lista mudou. Atualize para ver a versão atual."
              : "Não foi possível carregar suas mensagens."}
          </Text>
          <ActionButton
            onPress={() => {
              void refresh();
            }}
          >
            Atualizar
          </ActionButton>
        </>
      )}
      {result.isPending && (
        <ActivityIndicator accessibilityLabel="Carregando mensagens salvas" />
      )}
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        style={{ maxHeight: 560 }}
        onEndReached={() => {
          if (result.hasNextPage && !result.isFetching && !result.isError)
            void result.fetchNextPage();
        }}
        ListEmptyComponent={
          !result.isPending && !result.isError && !reset ? (
            <Text>Nenhuma mensagem salva neste espaço.</Text>
          ) : null
        }
        ListFooterComponent={
          result.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel="Carregando mais mensagens" />
          ) : null
        }
        renderItem={({ item }) => (
          <SavedRow item={item} onSelect={setSelected} onRemove={setRemoving} />
        )}
      />
      <ClearUnavailableSaved data={data} cacheScope={cacheScope} />
      {removing && (
        <SaveRoomMessage
          data={data}
          cacheScope={cacheScope}
          roomId={removing.id}
          messageId={removing.messageId}
          onClose={() => {
            setRemoving(undefined);
            void refresh();
          }}
        />
      )}
    </CompanionSheet>
  );
}

function SavedMessageContext({
  data,
  cacheScope,
  reference,
  onClose,
  onOpenRoom,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly reference: z.infer<typeof roomMediaReadSchema>;
  readonly onClose: () => void;
  readonly onOpenRoom: (id: string) => void;
}) {
  const [focus, setFocus] = useState(reference);
  const [profileId, setProfileId] = useState<string>();
  const result = useQuery({
    queryKey: ["matrix-context", cacheScope, focus.id, focus.messageId],
    queryFn: () => data.context(focus),
    staleTime: 0,
    retry: 1,
  });
  const value = result.isError ? undefined : result.data;
  const person = value?.members.find((member) => member.id === profileId);
  if (value && person)
    return (
      <ParticipantProfile
        person={person}
        data={data}
        cacheScope={cacheScope}
        direct={value.room.kind === "direct"}
        conversationAvatarUri={value.room.avatarUri ?? undefined}
        groupName={value.room.label}
        onOpenRoom={onOpenRoom}
        onClose={() => {
          setProfileId(undefined);
        }}
        onConversation={() => {
          onOpenRoom(focus.id);
        }}
      />
    );
  return (
    <CompanionSheet
      title={value?.room.label ?? "Mensagem original"}
      onClose={onClose}
    >
      {result.isPending && (
        <ActivityIndicator accessibilityLabel="Localizando mensagem original" />
      )}
      {result.isError && (
        <>
          <Text accessibilityRole="alert">
            Não foi possível acessar a mensagem original.
          </Text>
          <ActionButton
            onPress={() => {
              void result.refetch();
            }}
          >
            Tentar novamente
          </ActionButton>
        </>
      )}
      {value && (
        <ContextContent
          value={value}
          data={data}
          cacheScope={cacheScope}
          focus={focus}
          onFocus={setFocus}
          onProfile={setProfileId}
          onClose={onClose}
          onOpenRoom={onOpenRoom}
        />
      )}
    </CompanionSheet>
  );
}
function ContextMessage({
  item,
  data,
  roomId,
  cacheScope,
  person,
  onProfile,
}: {
  readonly item: z.infer<typeof roomMessageSchema>;
  readonly data: RoomData;
  readonly roomId: string;
  readonly cacheScope: string;
  readonly person:
    | ComponentProps<typeof ParticipantProfile>["person"]
    | undefined;
  readonly onProfile: (id: string) => void;
}) {
  return (
    <View style={{ paddingVertical: 12, gap: 6 }}>
      <Pressable
        accessibilityRole={person ? "button" : undefined}
        accessibilityLabel={person ? `Ver perfil de ${person.name}` : undefined}
        disabled={!person}
        onPress={() => {
          if (person) onProfile(person.id);
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          alignSelf: "flex-start",
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <ConversationAvatar
          name={item.sender}
          uri={person?.avatarUri ?? undefined}
          size={28}
        />
        <View>
          <Text style={{ fontWeight: "600" }}>
            {item.mine ? "Você" : item.sender}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {new Date(item.timestamp).toLocaleString()}
            {item.editId ? " · Editada" : ""}
          </Text>
        </View>
      </Pressable>
      {item.media ? (
        <RoomAttachment
          item={item}
          data={data}
          roomId={roomId}
          cacheScope={cacheScope}
        />
      ) : (
        <AssistantMarkdown text={item.text} />
      )}
    </View>
  );
}

function SavedRow({
  item,
  onSelect,
  onRemove,
}: {
  readonly item: z.infer<typeof savedMessagesPageSchema>["items"][number];
  readonly onSelect: (value: z.infer<typeof roomMediaReadSchema>) => void;
  readonly onRemove: (value: z.infer<typeof roomMediaReadSchema>) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 16,
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.wash,
      }}
    >
      <Pressable
        accessibilityRole="button"
        disabled={!item.room || !item.message}
        style={({ pressed }) => ({
          flex: 1,
          gap: 6,
          opacity: pressed ? 0.65 : 1,
        })}
        onPress={() => {
          onSelect(item.reference);
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontWeight: "600",
              fontSize: 16,
              color: colors.ink,
            }}
          >
            {item.room?.label ?? "Mensagem indisponível"}
          </Text>
          {item.room && item.message && (
            <ChevronRight size={16} color={colors.muted} />
          )}
        </View>
        <Text
          numberOfLines={3}
          style={{ color: colors.ink, fontSize: 15, lineHeight: 21 }}
        >
          {item.message?.text ??
            "O acesso ou a mensagem original não está mais disponível."}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          Salva em {new Date(item.savedAt).toLocaleDateString()}
        </Text>
      </Pressable>
      <IconButton
        label="Remover das salvas"
        icon={BookmarkX}
        onPress={() => {
          onRemove(item.reference);
        }}
      />
    </View>
  );
}

function ContextContent({
  value,
  data,
  cacheScope,
  focus,
  onFocus,
  onProfile,
  onClose,
  onOpenRoom,
}: Omit<ComponentProps<typeof SavedMessageContext>, "reference"> & {
  readonly value: z.infer<typeof import("./schema").roomContextSchema>;
  readonly focus: z.infer<typeof roomMediaReadSchema>;
  readonly onFocus: (value: z.infer<typeof roomMediaReadSchema>) => void;
  readonly onProfile: (id: string) => void;
}) {
  return (
    <ScrollView style={{ maxHeight: 560 }}>
      <Text style={{ fontWeight: "600" }}>Mensagem selecionada</Text>
      <ContextMessage
        item={value.target}
        data={data}
        cacheScope={cacheScope}
        roomId={focus.id}
        person={value.members.find(
          (member) => member.id === value.target.senderId
        )}
        onProfile={onProfile}
      />
      {value.root && (
        <ActionButton
          quiet
          onPress={() => {
            onFocus({
              id: focus.id,
              messageId: value.root?.id ?? value.target.id,
            });
          }}
        >
          Ver mensagem inicial da thread
        </ActionButton>
      )}
      <ActionButton
        quiet
        onPress={() => {
          onOpenRoom(focus.id);
          onClose();
        }}
      >
        Abrir conversa
      </ActionButton>
      <Text style={{ fontWeight: "600", marginTop: 18 }}>
        Contexto da conversa
      </Text>
      {value.messages.map((item) => (
        <View
          key={item.id}
          style={
            item.id === focus.messageId
              ? {
                  borderLeftWidth: 3,
                  borderLeftColor: colors.accent,
                  paddingLeft: 10,
                }
              : undefined
          }
        >
          <ContextMessage
            item={item}
            data={data}
            cacheScope={cacheScope}
            roomId={focus.id}
            person={value.members.find((member) => member.id === item.senderId)}
            onProfile={onProfile}
          />
        </View>
      ))}
    </ScrollView>
  );
}

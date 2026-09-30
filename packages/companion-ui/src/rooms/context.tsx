import { useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import {
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
import { ConversationAvatar } from "../chats/avatar";
import { systemFont, useColors } from "../theme";
import { RoomAttachment } from "./attachment";
import { ParticipantProfile } from "./profile";
import type {
  RoomData,
  roomMediaReadSchema,
  roomMessageSchema,
} from "./schema";
export function RoomMessageContext({
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
    queryFn: ({ signal }) => data.context(focus, signal),
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
  const value = result.isError || result.isFetching ? undefined : result.data;
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
      scrollable={false}
    >
      {result.isFetching && (
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
  const colors = useColors();
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
          <Text
            style={{
              fontFamily: systemFont,
              color: colors.muted,
              fontSize: 12,
            }}
          >
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
        <View
          style={{
            backgroundColor: colors.wash,
            borderRadius: 18,
            paddingHorizontal: 14,
            paddingVertical: 6,
          }}
        >
          <AssistantMarkdown text={item.text} compact />
        </View>
      )}
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
}: Omit<ComponentProps<typeof RoomMessageContext>, "reference"> & {
  readonly value: z.infer<typeof import("./schema").roomContextSchema>;
  readonly focus: z.infer<typeof roomMediaReadSchema>;
  readonly onFocus: (value: z.infer<typeof roomMediaReadSchema>) => void;
  readonly onProfile: (id: string) => void;
}) {
  const colors = useColors();
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

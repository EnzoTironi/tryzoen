import { useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { ArrowLeft, Info, X } from "lucide-react-native";
import type { z } from "zod";
import { Composer } from "../composer";
import { IconButton } from "../icon-button";
import { ConversationAvatar } from "../chats/avatar";
import { colors } from "../theme";
import { RoomMessages } from "./messages";
import { RoomDetails } from "./details";
import type { RoomData, roomMessageSchema } from "./schema";

export function RoomConversation({
  data,
  cacheScope,
  roomId,
  onBack,
  avatarUri,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly roomId: string;
  readonly onBack: () => void;
  readonly avatarUri?: string;
}) {
  const [root, setRoot] = useState<z.infer<typeof roomMessageSchema>>();
  const [details, setDetails] = useState(false);
  const wide = useWindowDimensions().width >= 1100;
  const compact = useWindowDimensions().width < 720;
  const messages = useInfiniteQuery({
    queryKey: ["matrix-messages", cacheScope, roomId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => data.messages({ id: roomId, from: pageParam }),
    getNextPageParam: (last, pages) =>
      pages.length < 5 ? (last.nextCursor ?? undefined) : undefined,
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 1,
  });
  const current = messages.isError ? undefined : messages.data;
  const room = current?.pages[0]?.room;
  const timeline = Array.from(
    new Map(
      current?.pages
        .reduceRight<z.infer<typeof roomMessageSchema>[]>(
          (items, page) => items.concat(page.messages),
          []
        )
        .map((message) => [message.id, message])
    ).values()
  );
  return (
    <View style={styles.layout}>
      {(!root || wide || messages.isError) && (
        <View style={styles.main}>
          <View style={styles.header}>
            {compact && (
              <IconButton
                icon={ArrowLeft}
                label="Voltar às conversas"
                onPress={onBack}
              />
            )}
            <ConversationAvatar name={room?.label ?? "Grupo"} group size={38} />
            <View style={styles.headerCopy}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={styles.title}
              >
                {room?.label ?? "Grupo"}
              </Text>
              <Text style={styles.caption}>
                Pessoas e Zoen · espaço compartilhado
              </Text>
            </View>
            <IconButton
              icon={Info}
              label="Detalhes do grupo"
              onPress={() => {
                setDetails(true);
              }}
            />
          </View>
          <RoomMessages
            avatarUri={avatarUri}
            messages={timeline.filter((message) => !message.rootId)}
            onThread={setRoot}
            loading={messages.isPending}
            error={Boolean(messages.error)}
            onRetry={() => {
              void messages.refetch();
            }}
            hasMore={messages.hasNextPage}
            loadingMore={messages.isFetchingNextPage}
            onMore={() => {
              void messages.fetchNextPage();
            }}
          />
          <RoomComposer
            key={roomId}
            data={data}
            cacheScope={cacheScope}
            roomId={roomId}
            disabled={!room || messages.isError}
          />
        </View>
      )}
      {root && !messages.isError && (
        <View style={[styles.thread, !wide && styles.fullThread]}>
          <View style={styles.header}>
            {!wide && (
              <IconButton
                icon={ArrowLeft}
                label="Fechar thread"
                onPress={() => {
                  setRoot(undefined);
                }}
              />
            )}
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Thread</Text>
              <Text numberOfLines={1} style={styles.caption}>
                Respostas à mensagem
              </Text>
            </View>
            {wide && (
              <IconButton
                icon={X}
                label="Fechar thread"
                onPress={() => {
                  setRoot(undefined);
                }}
              />
            )}
          </View>
          <RoomThread
            key={root.id}
            data={data}
            cacheScope={cacheScope}
            roomId={roomId}
            root={root}
            avatarUri={avatarUri}
          />
        </View>
      )}
      {details && current?.pages[0] && (
        <RoomDetails
          page={current.pages[0]}
          avatarUri={avatarUri}
          onClose={() => {
            setDetails(false);
          }}
          onConversation={() => {
            setDetails(false);
            setRoot(undefined);
          }}
        />
      )}
    </View>
  );
}

function RoomThread({
  data,
  cacheScope,
  roomId,
  root,
  avatarUri,
}: Pick<
  Parameters<typeof RoomConversation>[0],
  "data" | "cacheScope" | "roomId" | "avatarUri"
> & { readonly root: z.infer<typeof roomMessageSchema> }) {
  const result = useInfiniteQuery({
    queryKey: ["matrix-thread", cacheScope, roomId, root.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      data.thread({ id: roomId, rootId: root.id, from: pageParam }),
    getNextPageParam: (last, pages) =>
      pages.length < 5 ? (last.nextCursor ?? undefined) : undefined,
    refetchInterval: 10_000,
    retry: 1,
  });
  const replies = Array.from(
    new Map(
      result.data?.pages
        .reduceRight<z.infer<typeof roomMessageSchema>[]>(
          (items, page) => items.concat(page.messages),
          []
        )
        .map((message) => [message.id, message])
    ).values()
  );
  return (
    <>
      <RoomMessages
        avatarUri={avatarUri}
        messages={
          result.isError
            ? []
            : [result.data?.pages[0]?.parent ?? root, ...replies]
        }
        loading={result.isPending}
        error={Boolean(result.error)}
        onRetry={() => {
          void result.refetch();
        }}
        hasMore={result.hasNextPage}
        loadingMore={result.isFetchingNextPage}
        onMore={() => {
          void result.fetchNextPage();
        }}
      />
      <RoomComposer
        data={data}
        cacheScope={cacheScope}
        roomId={roomId}
        rootId={root.id}
        disabled={!result.data || result.isError}
      />
    </>
  );
}

function RoomComposer({
  data,
  cacheScope,
  roomId,
  rootId,
  disabled,
}: Pick<
  Parameters<typeof RoomConversation>[0],
  "data" | "cacheScope" | "roomId"
> & { readonly rootId?: string; readonly disabled: boolean }) {
  const client = useQueryClient();
  const pending = useRef<{ text: string; id: string } | undefined>(undefined);
  return (
    <View style={styles.composer}>
      <Composer
        attachments={false}
        maxLength={8000}
        label={rootId ? "Responder à thread" : "Mensagem ao grupo"}
        placeholder={rootId ? "Responder…" : "Mensagem…"}
        disabled={disabled}
        onSend={async ({ text }) => {
          if (!pending.current || pending.current.text !== text)
            pending.current = { text, id: data.operationId() };
          await data.send({
            id: roomId,
            operationId: pending.current.id,
            text,
            rootId,
          });
          pending.current = undefined;
          void client.invalidateQueries({
            queryKey: ["matrix-messages", cacheScope, roomId],
          });
          if (rootId)
            void client.invalidateQueries({
              queryKey: ["matrix-thread", cacheScope, roomId, rootId],
            });
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  layout: {
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
    backgroundColor: colors.surface,
  },
  main: { flex: 1, minWidth: 0 },
  header: {
    minHeight: 78,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#efeff1",
  },
  headerCopy: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 17, fontWeight: "600", color: colors.ink },
  caption: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  thread: { width: 320, borderLeftWidth: 1, borderLeftColor: "#ededf0" },
  fullThread: { width: "100%", borderLeftWidth: 0 },
  composer: { padding: 16 },
});

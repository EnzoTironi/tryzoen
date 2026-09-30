import { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  CircleAlert,
  ShieldCheck,
  ShieldQuestion,
  X,
} from "lucide-react-native";
import type { z } from "zod";
import { systemFont, useColors } from "../theme";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import type {
  ActivityData,
  activityItemSchema,
  activityPageSchema,
} from "./schema";

const presentations = {
  "turn.completed": { label: "Concluído", Icon: Check },
  "turn.failed": { label: "Não foi possível concluir", Icon: CircleAlert },
  "turn.cancelled": { label: "Cancelado", Icon: X },
  "session.failed": { label: "Conversa interrompida", Icon: CircleAlert },
  "approval.candidate": { label: "Aprovação solicitada", Icon: ShieldQuestion },
  "approval.settled": { label: "Decisão registrada", Icon: ShieldCheck },
};

export function AgentActivity({
  data,
  cacheScope,
  approvals,
  onSelect,
}: {
  readonly data: ActivityData;
  readonly cacheScope: string;
  readonly approvals: boolean;
  readonly onSelect: (sessionId: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const client = useQueryClient();
  const key = ["agent-activity", cacheScope, approvals];
  const history = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as z.infer<typeof activityPageSchema>["nextCursor"],
    queryFn: ({ pageParam, signal }) =>
      data.activity({ approvals, cursor: pageParam }, signal),
    getNextPageParam: (last, _pages, _last, previous) =>
      last.nextCursor &&
      !previous.some(
        (cursor) =>
          cursor?.id === last.nextCursor?.id &&
          cursor?.at === last.nextCursor?.at
      )
        ? last.nextCursor
        : undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const refresh = async () => {
    await client.cancelQueries({ queryKey: key, exact: true });
    client.setQueryData<InfiniteData<z.infer<typeof activityPageSchema>>>(
      key,
      (current) =>
        current
          ? {
              pages: current.pages.slice(0, 1),
              pageParams: current.pageParams.slice(0, 1),
            }
          : current
    );
    await history.refetch();
  };
  const items = history.isError
    ? []
    : Array.from(
        new Map(
          (history.data?.pages ?? [])
            .flatMap((page) => page.items)
            .map((item) => [item.id, item])
        ).values()
      );
  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.content}
      refreshing={history.isRefetching}
      onRefresh={() => {
        void refresh();
      }}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (history.hasNextPage && !history.isFetching && !history.isError)
          void history.fetchNextPage();
      }}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text accessibilityRole="header" style={pageStyles.heading}>
            {approvals ? "Histórico de aprovações" : "Atividade recente"}
          </Text>
          <Text style={pageStyles.copy}>
            Suas conversas · Abra um registro para ver os detalhes.
          </Text>
          {history.isError && (
            <View style={styles.feedback}>
              <Text accessibilityRole="alert" style={pageStyles.copy}>
                Não foi possível carregar a atividade.
              </Text>
              <ActionButton
                quiet
                onPress={() => {
                  void refresh();
                }}
              >
                Tentar novamente
              </ActionButton>
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        history.isPending ? (
          <ActivityIndicator
            accessibilityLabel="Carregando atividade"
            color={colors.accent}
          />
        ) : !history.isError ? (
          <Text style={pageStyles.copy}>
            Nenhuma atividade recente registrada. O histórico disponível aparece
            aqui conforme você conversa.
          </Text>
        ) : null
      }
      ListFooterComponent={
        history.isFetchingNextPage ? (
          <ActivityIndicator
            accessibilityLabel="Carregando mais atividade"
            color={colors.accent}
          />
        ) : null
      }
      renderItem={({ item }) => <ActivityRow item={item} onSelect={onSelect} />}
    />
  );
}

function ActivityRow({
  item,
  onSelect,
}: {
  readonly item: z.infer<typeof activityItemSchema>;
  readonly onSelect: (sessionId: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pageStyles = usePageStyles();
  const { label, Icon } = presentations[item.kind];
  const date = new Date(item.at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title} · ${label} · ${date}`}
      onPress={() => {
        onSelect(item.sessionId);
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <Icon size={22} color={colors.ink} strokeWidth={1.6} />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={2} style={pageStyles.rowTitle}>
          {item.title}
        </Text>
        <Text style={pageStyles.copy}>{label}</Text>
        <Text style={styles.date}>{date}</Text>
      </View>
      <ChevronRight size={17} color={colors.muted} />
    </Pressable>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    content: { padding: 20, paddingBottom: 40, flexGrow: 1 },
    header: { gap: 2, paddingBottom: 16 },
    feedback: { gap: 10, alignItems: "flex-start", paddingVertical: 20 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingVertical: 16,
      borderRadius: 16,
    },
    pressed: { backgroundColor: colors.wash },
    icon: {
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: colors.wash,
      alignItems: "center",
      justifyContent: "center",
    },
    copy: { flex: 1, gap: 3 },
    date: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 12,
      lineHeight: 18,
    },
  });
}

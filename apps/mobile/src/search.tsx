"use client";
import { useDeferredValue, useState } from "react";
import { ConversationSearch } from "@zoen/companion-ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { queries } from "./api";
export function SearchSection({
  onConversation,
  title,
  intro,
  allowCreate = true,
}: {
  readonly onConversation: (id?: string) => void;
  readonly title?: string;
  readonly intro?: string;
  readonly allowCreate?: boolean;
}) {
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query);
  const chats = useInfiniteQuery({
    queryKey: ["chats", search],
    queryFn: ({ pageParam }) => queries.chats(search, pageParam),
    initialPageParam: null as Parameters<typeof queries.chats>[1],
    getNextPageParam: (last) => last.nextCursor,
  });
  return (
    <ConversationSearch
      title={title}
      intro={intro}
      query={query}
      onQuery={setQuery}
      items={
        chats.data?.pages.flatMap((page) =>
          page.items.map((chat) => ({
            id: chat.sessionId,
            title: chat.title,
            description: new Date(chat.updatedAt).toLocaleString(),
          }))
        ) ?? []
      }
      onOpen={onConversation}
      onCreate={
        allowCreate
          ? () => {
              onConversation();
            }
          : undefined
      }
      loading={chats.isPending || chats.isFetchingNextPage}
      error={chats.error?.message}
      onRetry={() => {
        void chats.refetch();
      }}
      onLoadMore={
        chats.hasNextPage
          ? () => {
              void chats.fetchNextPage();
            }
          : undefined
      }
    />
  );
}

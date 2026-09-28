import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { ChatData, chatPageSchema } from "./schema";

export function useConversationLibrary(
  data: ChatData,
  cacheScope: string,
  search: string,
  archived: boolean
) {
  const client = useQueryClient();
  const key = ["conversation-library", cacheScope];
  const chats = useInfiniteQuery({
    queryKey: [...key, archived, search],
    initialPageParam: null as z.infer<typeof chatPageSchema>["nextCursor"],
    queryFn: ({ pageParam }) =>
      data.list({ query: search, archived, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 15_000,
    gcTime: 60_000,
  });
  const change: ChatData["change"] = async (input) => {
    await data.change(input);
    await client.invalidateQueries({ queryKey: key });
  };
  return {
    chats,
    items: chats.data?.pages.flatMap((page) => page.items) ?? [],
    change,
  };
}

import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type { z } from "zod";
import { SlidersHorizontal } from "lucide-react-native";
import { Text, View } from "react-native";
import { CompanionPage, usePageStyles } from "../page";
import { IconButton } from "../icon-button";
import { ActionButton } from "../button";
import { FeedCard } from "./card";
import { FeedOptions } from "./options";
import { feedLikeSchema } from "./schema";
import type {
  feedCursorSchema,
  feedPageSchema,
  feedInstructionsSchema,
} from "./schema";
import { FeedInstructions } from "./instructions";
import { replyMessage } from "../session/reply";

export interface FeedData {
  list: (
    cursor?: z.infer<typeof feedCursorSchema> | null
  ) => Promise<z.infer<typeof feedPageSchema>>;
  like: (input: z.infer<typeof feedLikeSchema>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  instructions: () => Promise<z.infer<typeof feedInstructionsSchema>>;
  saveInstructions: (
    input: z.infer<typeof feedInstructionsSchema>
  ) => Promise<z.infer<typeof feedInstructionsSchema>>;
}

export function FeedCollection({
  data,
  cacheScope,
  onPrompt,
}: {
  readonly data: FeedData;
  readonly cacheScope: string;
  readonly onPrompt: (prompt: string) => void;
}) {
  const pageStyles = usePageStyles();
  const client = useQueryClient();
  const [likeError, setLikeError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState(false);
  const feed = useInfiniteQuery({
    queryKey: ["personal-feed", cacheScope],
    queryFn: ({ pageParam }) => data.list(pageParam),
    initialPageParam: null as z.infer<typeof feedCursorSchema> | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 30_000,
  });
  const likeKey = ["feed-like", cacheScope];
  const pendingLikes = useMutationState({
    filters: { mutationKey: likeKey, status: "pending" },
    select: (mutation) => feedLikeSchema.parse(mutation.state.variables),
  });
  const like = useMutation({
    mutationKey: likeKey,
    scope: { id: JSON.stringify(likeKey) },
    mutationFn: data.like,
    onMutate: () => {
      setLikeError(undefined);
    },
    onSuccess: (_result, input) => {
      client.setQueryData<InfiniteData<z.infer<typeof feedPageSchema>>>(
        ["personal-feed", cacheScope],
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((post) =>
                post.id === input.id ? { ...post, liked: input.liked } : post
              ),
            })),
          }
      );
    },
    onError: () => {
      setLikeError("Your reaction could not be saved. Please try again.");
    },
    onSettled: () => {
      if (client.isMutating({ mutationKey: likeKey }) === 1)
        void client.invalidateQueries({
          queryKey: ["personal-feed", cacheScope],
        });
    },
  });
  const remove = useMutation({
    mutationFn: data.remove,
    onSuccess: async () => {
      setSelected(undefined);
      await feed.refetch();
    },
  });
  const liked = new Map(pendingLikes.map((input) => [input.id, input.liked]));
  const items = (feed.data?.pages.flatMap((page) => page.items) ?? []).map(
    (post) =>
      liked.has(post.id)
        ? Object.assign({}, post, { liked: liked.get(post.id) ?? post.liked })
        : post
  );
  const current = items.find((post) => post.id === selected);
  const customize = () => {
    onPrompt(
      "Help me shape my personal Feed. Read my preferences, then ask what topics, sources and frequency I want. Save a useful first post after we agree on the topic. Confirm any recurring schedule separately before enabling it."
    );
  };
  return (
    <>
      <CompanionPage
        title="Feed"
        contentMaxWidth={768}
        actions={
          <IconButton
            label="Customize feed"
            icon={SlidersHorizontal}
            onPress={() => {
              setEditing(true);
            }}
          />
        }
        loading={feed.isPending}
        error={feed.error?.message ?? likeError}
        onRetry={() => {
          setLikeError(undefined);
          like.reset();
          void feed.refetch();
        }}
      >
        {items.map((post) => (
          <FeedCard
            key={post.id}
            post={post}
            pending={false}
            onLike={() => {
              like.mutate({ id: post.id, liked: !post.liked });
            }}
            onOptions={() => {
              remove.reset();
              setSelected(post.id);
            }}
            onDiscuss={() => {
              onPrompt(
                replyMessage("", {
                  id: `feed:${post.id}`,
                  role: "assistant",
                  text: post.title,
                })
              );
            }}
          />
        ))}
        {!feed.isPending && !feed.isError && items.length === 0 && (
          <View style={pageStyles.empty}>
            <Text style={pageStyles.heading}>A feed shaped around you</Text>
            <Text style={pageStyles.copy}>
              Thoughtful updates on the things you care about, with sources and
              room to explore.
            </Text>
            <ActionButton onPress={customize}>Set up my feed</ActionButton>
          </View>
        )}
        {feed.hasNextPage && (
          <ActionButton
            quiet
            disabled={feed.isFetchingNextPage}
            onPress={() => {
              void feed.fetchNextPage();
            }}
          >
            Load more
          </ActionButton>
        )}
      </CompanionPage>
      {editing && (
        <FeedInstructions
          data={data}
          cacheScope={cacheScope}
          onClose={() => {
            setEditing(false);
          }}
        />
      )}
      {current && (
        <FeedOptions
          key={current.id}
          post={current}
          pending={remove.isPending}
          error={remove.error?.message}
          onDelete={() => {
            remove.mutate(current.id);
          }}
          onClose={() => {
            setSelected(undefined);
          }}
        />
      )}
    </>
  );
}

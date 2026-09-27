import { randomUUID } from "expo-crypto";
import { useDeferredValue, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  ActionButton,
  CompanionPage,
  ConversationSearch,
  Feed,
  Goals,
  Ideas,
  Library,
  type CompanionSection,
} from "@zoen/companion-ui";
import { chatStarters } from "../../../app/(authenticated)/_lib/chat-starters";
import { queries, rpc } from "./api";
import { apiOrigin } from "./environment";
import { auth } from "./auth";

export function MobileSections({
  section,
  onPrompt,
  onConversation,
  onSignOut,
}: {
  readonly section: Exclude<CompanionSection, "chat">;
  readonly onPrompt: (text: string) => void;
  readonly onConversation: (id?: string) => void;
  readonly onSignOut: () => Promise<void>;
}) {
  if (section === "ideas")
    return (
      <Ideas
        items={chatStarters.map((item) => ({
          id: item.id,
          title: item.label,
          description: item.description,
          category: item.category,
          prompt: item.text,
          imageUri: `${apiOrigin}/marketing/panel/zoen-${item.id === "preference" ? "memory" : item.id === "email-draft" ? "email" : item.id}.png`,
        }))}
        onChoose={onPrompt}
      />
    );
  if (section === "search")
    return <SearchSection onConversation={onConversation} />;
  if (section === "goals") return <GoalsSection onPrompt={onPrompt} />;
  if (section === "feed")
    return <FeedSection onPrompt={onPrompt} onConversation={onConversation} />;
  if (section === "library") return <LibrarySection onPrompt={onPrompt} />;
  return <SettingsSection onSignOut={onSignOut} onPrompt={onPrompt} />;
}
function SearchSection({
  onConversation,
}: {
  readonly onConversation: (id?: string) => void;
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
      onCreate={() => {
        onConversation();
      }}
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
function GoalsSection({
  onPrompt,
}: {
  readonly onPrompt: (text: string) => void;
}) {
  const goals = useQuery({ queryKey: ["goals"], queryFn: queries.goals });
  const toggle = useMutation({
    mutationFn: (input: {
      id: string;
      scopeKey: string;
      expectedRevision: number;
      completed: boolean;
      operationId: string;
    }) => rpc.mutation("companion.setGoalCompleted", input),
    onSuccess: async () => {
      await goals.refetch();
    },
  });
  const items = goals.data ?? [];
  return (
    <Goals
      items={items.map((item) => ({
        id: `${item.scopeKey}:${item.id}`,
        title: item.content?.title ?? item.id,
        description: item.content?.nextStep.trim()
          ? item.content.nextStep
          : (item.content?.objective ?? ""),
        completed: item.content?.status === "completed",
      }))}
      loading={goals.isPending}
      error={goals.error?.message ?? toggle.error?.message}
      onRetry={() => {
        toggle.reset();
        void goals.refetch();
      }}
      pendingId={
        toggle.isPending
          ? `${toggle.variables.scopeKey}:${toggle.variables.id}`
          : undefined
      }
      onOpen={(id) => {
        const item = items.find((goal) => `${goal.scopeKey}:${goal.id}` === id);
        if (item)
          onPrompt(
            `Read my saved workstream ${item.id} and help me review its progress.`
          );
      }}
      onCreate={(category) => {
        onPrompt(
          `Help me create a goal in ${category}. Ask what I want to achieve and save the agreed goal as a workstream. Confirm any schedule separately before enabling it.`
        );
      }}
      onToggle={(id) => {
        const item = items.find((goal) => `${goal.scopeKey}:${goal.id}` === id);
        if (!item || toggle.isPending) return;
        toggle.mutate({
          id: item.id,
          scopeKey: item.scopeKey,
          expectedRevision: item.revision,
          completed: item.content?.status !== "completed",
          operationId: randomUUID(),
        });
      }}
    />
  );
}
function FeedSection({
  onPrompt,
  onConversation,
}: {
  readonly onPrompt: (text: string) => void;
  readonly onConversation: (id?: string) => void;
}) {
  const feed = useInfiniteQuery({
    queryKey: ["feed"],
    queryFn: ({ pageParam }) => queries.feed(pageParam),
    initialPageParam: null as Parameters<typeof queries.feed>[0],
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Feed
      items={items
        .filter((item) => item.outcome.kind !== "nothing_to_report")
        .map((item) => ({
          id: item.id,
          title: item.title,
          content:
            item.outcome.kind === "result"
              ? [item.outcome.summary, item.outcome.details]
                  .filter(Boolean)
                  .join("\n\n")
              : item.outcome.kind === "blocked"
                ? `${item.outcome.summary}\n\n${item.outcome.userActionNeeded}`
                : item.outcome.reason,
          date: new Date(item.date).toLocaleString(),
        }))}
      onDiscuss={(id) => {
        const item = items.find((post) => post.id === id);
        if (item?.sessionId) onConversation(item.sessionId);
        else if (item)
          onPrompt(`Let's discuss my scheduled update: ${item.title}`);
      }}
      onCustomize={() => {
        onPrompt(
          "Help me set up a personal feed of scheduled briefings. Ask about my interests, sources, frequency, and timezone. Show the plan and confirm it before creating a schedule."
        );
      }}
      loading={feed.isPending || feed.isFetchingNextPage}
      error={feed.error?.message}
      onRetry={() => {
        void feed.refetch();
      }}
      onLoadMore={
        feed.hasNextPage
          ? () => {
              void feed.fetchNextPage();
            }
          : undefined
      }
    />
  );
}
function LibrarySection({
  onPrompt,
}: {
  readonly onPrompt: (text: string) => void;
}) {
  const files = useQuery({
    queryKey: ["files"],
    queryFn: () => queries.files(),
  });
  const [path, setPath] = useState<string>();
  if (path)
    return (
      <FileSection
        key={path}
        path={path}
        onClose={() => {
          setPath(undefined);
        }}
      />
    );
  return (
    <Library
      items={(files.data?.files ?? []).map((file) => ({
        id: file,
        title: file.split("/").at(-1) ?? file,
        description: file,
      }))}
      onOpen={setPath}
      onCreate={() => {
        onPrompt(
          "Help me create a document. Ask what I want to make, then save the finished file in my workspace knowledge folder."
        );
      }}
      loading={files.isPending}
      error={files.error?.message}
      onRetry={() => {
        void files.refetch();
      }}
    />
  );
}
function FileSection({
  path,
  onClose,
}: {
  readonly path: string;
  readonly onClose: () => void;
}) {
  const file = useQuery({
    queryKey: ["files", path],
    queryFn: () => queries.files(path),
  });
  const [draft, setDraft] = useState<{
    content: string;
    expectedRevision: string | null;
    operationId: string;
  }>();
  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("There are no edits to save.");
      return await rpc.mutation("workspaces.write", { path, ...draft });
    },
    onSuccess: async () => {
      await file.refetch();
      setDraft(undefined);
    },
  });
  return (
    <CompanionPage
      title={path.split("/").at(-1) ?? path}
      loading={file.isPending}
      error={file.error?.message ?? save.error?.message}
      onRetry={() => {
        void file.refetch();
      }}
      actions={
        <ActionButton
          quiet
          disabled={draft !== undefined || save.isPending}
          onPress={onClose}
        >
          Back
        </ActionButton>
      }
    >
      {file.data && (
        <View style={{ gap: 16 }}>
          <TextInput
            accessibilityLabel="File content"
            multiline
            value={draft?.content ?? file.data.content ?? ""}
            onChangeText={(content) => {
              setDraft((current) => ({
                content,
                expectedRevision: current
                  ? current.expectedRevision
                  : file.data.revision,
                operationId: randomUUID(),
              }));
              save.reset();
            }}
            editable={!save.isPending}
            style={{
              minHeight: 300,
              fontSize: 16,
              lineHeight: 24,
              padding: 16,
              backgroundColor: "#ededee",
              borderRadius: 16,
              textAlignVertical: "top",
            }}
          />
          <ActionButton
            disabled={draft === undefined || save.isPending}
            onPress={() => {
              save.mutate();
            }}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </ActionButton>
          {draft !== undefined && (
            <ActionButton
              quiet
              disabled={save.isPending}
              onPress={() => {
                setDraft(undefined);
              }}
            >
              Discard edits
            </ActionButton>
          )}
        </View>
      )}
    </CompanionPage>
  );
}
function SettingsSection({
  onSignOut,
  onPrompt,
}: {
  readonly onSignOut: () => Promise<void>;
  readonly onPrompt: (text: string) => void;
}) {
  const session = auth.useSession();
  const signOut = useMutation({ mutationFn: onSignOut });
  return (
    <CompanionPage title="Settings" error={signOut.error?.message}>
      <View style={{ gap: 24 }}>
        <Text style={{ fontSize: 20 }}>{session.data?.user.name}</Text>
        <Text>{session.data?.user.email}</Text>
        <ActionButton
          quiet
          onPress={() => {
            onPrompt(
              "Help me review my connected tools, available models, and account preferences. Ask what I want to change before applying anything."
            );
          }}
        >
          Connections and preferences
        </ActionButton>
        <ActionButton
          quiet
          onPress={() => {
            onPrompt(
              "Show what you remember about me so I can review and correct it."
            );
          }}
        >
          Personal memory
        </ActionButton>
        <ActionButton
          disabled={signOut.isPending}
          quiet
          onPress={() => {
            signOut.mutate();
          }}
        >
          Sign out
        </ActionButton>
      </View>
    </CompanionPage>
  );
}

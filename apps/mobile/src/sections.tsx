import { SearchSection } from "./search";
import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  ActionButton,
  CompanionPage,
  DocumentEditor,
  Feed,
  GoalCollection,
  IdeaCollection,
  Library,
  type CompanionSection,
} from "@zoen/companion-ui";
import { companionIdeasData } from "../../../shared/companion/ideas";
import { client } from "./conversation";
import { queries, rpc } from "./api";
import { auth } from "./auth";
import { MobileMemory } from "./agent-panel";
import { companionGoalsData } from "../../../shared/companion/goals";
import { companionDocumentHistory } from "../../../shared/companion/files";

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
    return <IdeasSection onPrompt={onPrompt} onConversation={onConversation} />;
  if (section === "search")
    return <SearchSection onConversation={onConversation} />;
  if (section === "goals") return <GoalsSection onPrompt={onPrompt} />;
  if (section === "feed")
    return <FeedSection onPrompt={onPrompt} onConversation={onConversation} />;
  if (section === "library") return <LibrarySection onPrompt={onPrompt} />;
  return <SettingsSection onSignOut={onSignOut} onPrompt={onPrompt} />;
}
function IdeasSection({
  onPrompt,
  onConversation,
}: {
  readonly onPrompt: (text: string) => void;
  readonly onConversation: (id: string) => void;
}) {
  const session = auth.useSession();
  return (
    <IdeaCollection
      data={mobileIdeas}
      cacheScope={session.data?.user.id ?? "anonymous"}
      onPrompt={onPrompt}
      onConversation={onConversation}
    />
  );
}
const mobileIdeas = companionIdeasData(rpc, client);

function GoalsSection({
  onPrompt,
}: {
  readonly onPrompt: (text: string) => void;
}) {
  const session = auth.useSession();
  return (
    <GoalCollection
      data={mobileGoals}
      cacheScope={session.data?.user.id ?? "anonymous"}
      onPrompt={onPrompt}
    />
  );
}
const mobileGoals = companionGoalsData(rpc, randomUUID);

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
  const session = auth.useSession();
  const file = useQuery({
    queryKey: ["files", path],
    queryFn: () => queries.files(path),
  });
  const pendingSave = useRef<{
    content: string;
    revision: string | null;
    operationId: string;
  }>(undefined);
  // Capture the revision when the editor opens; background refetches must never
  // grant a stale draft permission to overwrite newer work.
  const [snapshot, setSnapshot] = useState<typeof file.data>();
  if (file.data && !snapshot) setSnapshot(file.data);
  if (snapshot)
    return (
      <DocumentEditor
        title={path.split("/").at(-1) ?? path}
        label="File content"
        description="Only this workspace can access this document."
        initialText={snapshot.content ?? ""}
        maxLength={262144}
        markdown={path.endsWith(".md")}
        history={companionDocumentHistory(
          rpc,
          path,
          session.data?.user.id ?? "signed-out"
        )}
        readOnly={!snapshot.canEdit}
        onClose={onClose}
        onSave={async (content) => {
          if (pendingSave.current?.content !== content)
            pendingSave.current = {
              content,
              revision: snapshot.revision,
              operationId: randomUUID(),
            };
          await rpc.mutation("workspaces.write", {
            path,
            content,
            expectedRevision: snapshot.revision,
            operationId: pendingSave.current.operationId,
          });
          await file.refetch();
        }}
      />
    );
  return (
    <CompanionPage
      title={path.split("/").at(-1) ?? path}
      loading={file.isPending}
      error={file.error?.message}
      onRetry={() => {
        void file.refetch();
      }}
      actions={
        <ActionButton quiet onPress={onClose}>
          Back
        </ActionButton>
      }
    >
      {null}
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
  const [memory, setMemory] = useState(false);
  if (memory)
    return (
      <>
        <ActionButton
          quiet
          onPress={() => {
            setMemory(false);
          }}
        >
          Back to settings
        </ActionButton>
        <MobileMemory onPrompt={onPrompt} />
      </>
    );
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
            setMemory(true);
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

"use client";
import { ConnectedSearch } from "./search";
import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import { companionGoalsData } from "@shared/companion/goals";
import {
  IdeaCollection,
  GoalCollection,
  Feed,
  Library,
  CompanionPage,
  ActionButton,
  type CompanionSection,
} from "@zoen/companion-ui";
import { api } from "@web/trpc/client";
import { companionIdeasData } from "@shared/companion/ideas";
import { browserSessionClient } from "@web/eve/client";
import { FileEditor } from "@app/(authenticated)/space/(overview)/_components/file-editor";
import { ModelConnections } from "@app/(authenticated)/_components/model-connections";
import { WorkspaceSwitcher } from "@app/(authenticated)/_components/workspace-switcher";
import { ConnectedMemory } from "./agent-panel";

export function ConnectedSections({
  section,
  onPrompt,
  onConversation,
}: {
  readonly section: Exclude<CompanionSection, "chat">;
  readonly onPrompt: (prompt: string) => void;
  readonly onConversation: (sessionId?: string) => void;
}) {
  if (section === "ideas")
    return (
      <ConnectedIdeas onPrompt={onPrompt} onConversation={onConversation} />
    );
  if (section === "goals") return <ConnectedGoals onPrompt={onPrompt} />;
  if (section === "search")
    return <ConnectedSearch onConversation={onConversation} />;
  if (section === "library") return <ConnectedLibrary onPrompt={onPrompt} />;
  if (section === "feed")
    return (
      <ConnectedFeed onPrompt={onPrompt} onConversation={onConversation} />
    );
  return <ConnectedSettings onPrompt={onPrompt} />;
}

function ConnectedSettings({
  onPrompt,
}: {
  readonly onPrompt: (prompt: string) => void;
}) {
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
        <ConnectedMemory onPrompt={onPrompt} />
      </>
    );
  return (
    <CompanionPage title="Settings">
      <WorkspaceSwitcher />
      <ModelConnections />
      <ActionButton
        quiet
        onPress={() => {
          setMemory(true);
        }}
      >
        Personal memory
      </ActionButton>
    </CompanionPage>
  );
}

function ConnectedIdeas({
  onPrompt,
  onConversation,
}: {
  readonly onPrompt: (text: string) => void;
  readonly onConversation: (id: string) => void;
}) {
  const { client } = api.useUtils();
  const params = useSearchParams();
  const data = useMemo(
    () => companionIdeasData(getUntypedClient(client), browserSessionClient),
    [client]
  );
  return (
    <IdeaCollection
      data={data}
      cacheScope={params.get("space") ?? "personal"}
      onPrompt={onPrompt}
      onConversation={onConversation}
    />
  );
}

function ConnectedGoals({
  onPrompt,
}: {
  readonly onPrompt: (text: string) => void;
}) {
  const { client } = api.useUtils();
  const params = useSearchParams();
  const data = useMemo(
    () =>
      companionGoalsData(getUntypedClient(client), () => crypto.randomUUID()),
    [client]
  );
  return (
    <GoalCollection
      data={data}
      cacheScope={params.get("space") ?? "personal"}
      onPrompt={onPrompt}
    />
  );
}

function ConnectedLibrary({
  onPrompt,
}: {
  readonly onPrompt: (text: string) => void;
}) {
  const files = api.workspaces.files.useQuery({});
  const [path, setPath] = useState<string>();
  if (path)
    return (
      <ConnectedFile
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
          "Help me create a document. Ask what I want to make, then save the finished file in my workspace knowledge folder so I can find it in my library."
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

function ConnectedFeed({
  onPrompt,
  onConversation,
}: {
  readonly onPrompt: (text: string) => void;
  readonly onConversation: (id?: string) => void;
}) {
  const feed = api.companion.feed.useInfiniteQuery(
    {},
    { getNextPageParam: (last) => last.nextCursor }
  );
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

function ConnectedFile({
  path,
  onClose,
}: {
  readonly path: string;
  readonly onClose: () => void;
}) {
  const file = api.workspaces.files.useQuery({ path });
  return (
    <CompanionPage
      title={path.split("/").at(-1) ?? path}
      loading={file.isPending}
      error={file.error?.message}
      onRetry={() => {
        void file.refetch();
      }}
    >
      {file.data && (
        <FileEditor
          path={path}
          content={file.data.content ?? ""}
          revision={file.data.revision}
          readOnly={!file.data.canEdit}
          onClose={onClose}
          onSaved={async () => {
            await file.refetch();
          }}
        />
      )}
    </CompanionPage>
  );
}

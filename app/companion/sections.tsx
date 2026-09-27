"use client";
import { ConnectedSearch } from "./search";
import { useState } from "react";
import {
  Ideas,
  Goals,
  Feed,
  Library,
  CompanionPage,
  ActionButton,
  type CompanionSection,
} from "@zoen/companion-ui";
import { api } from "@web/trpc/client";
import { chatStarters } from "@app/(authenticated)/_lib/chat-starters";
import { useI18n } from "@web/i18n/context";
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
  const { t } = useI18n();
  if (section === "ideas")
    return (
      <Ideas
        items={chatStarters.map((item) => ({
          id: item.id,
          title: t(item.label),
          description: t(item.description),
          prompt: t(item.text),
          category: t(item.category),
          imageUri: `/marketing/panel/zoen-${item.id === "preference" ? "memory" : item.id === "email-draft" ? "email" : item.id}.png`,
        }))}
        onChoose={onPrompt}
      />
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

function ConnectedGoals({
  onPrompt,
}: {
  readonly onPrompt: (text: string) => void;
}) {
  const goals = api.companion.goals.useQuery();
  const complete = api.companion.setGoalCompleted.useMutation({
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
      error={goals.error?.message ?? complete.error?.message}
      pendingId={
        complete.isPending
          ? `${complete.variables.scopeKey}:${complete.variables.id}`
          : undefined
      }
      onRetry={() => {
        complete.reset();
        void goals.refetch();
      }}
      onOpen={(id) => {
        const item = items.find((goal) => `${goal.scopeKey}:${goal.id}` === id);
        if (item)
          onPrompt(
            `Read my saved workstream ${item.id} (${item.content?.title ?? ""}) and help me review its progress and next step.`
          );
      }}
      onCreate={(category) => {
        onPrompt(
          `Help me create a goal in ${category}. Ask what I want to achieve and save the agreed goal as a workstream. Explain any schedule separately before enabling it.`
        );
      }}
      onToggle={(id) => {
        const item = items.find((goal) => `${goal.scopeKey}:${goal.id}` === id);
        if (!item || complete.isPending) return;
        complete.mutate({
          id: item.id,
          scopeKey: item.scopeKey,
          expectedRevision: item.revision,
          completed: item.content?.status !== "completed",
          operationId: crypto.randomUUID(),
        });
      }}
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
          readOnly={false}
          onClose={onClose}
          onSaved={async () => {
            await file.refetch();
          }}
        />
      )}
    </CompanionPage>
  );
}

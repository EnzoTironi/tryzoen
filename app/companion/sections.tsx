"use client";
import { ConnectedCreatorStudio } from "./settings/creators";
import { ConnectedSearch } from "./search";
import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import { companionKnowledgeData } from "@shared/companion/knowledge";
import { companionGoalsData } from "@shared/companion/goals";
import {
  IdeaCollection,
  GoalCollection,
  FeedCollection,
  Library,
  CompanionPage,
  type CompanionSection,
} from "@zoen/companion-ui";
import { api } from "@web/trpc/client";
import { companionFeedData } from "@shared/companion/feed";
import { companionIdeasData } from "@shared/companion/ideas";
import { browserSessionClient } from "@web/eve/client";
import { FileEditor } from "@app/(authenticated)/space/(overview)/_components/file-editor";

export function ConnectedSections({
  section,
  onPrompt,
  onConversation,
}: {
  readonly section: Exclude<CompanionSection, "chat">;
  readonly onPrompt: (prompt: string) => void;
  readonly onConversation: (sessionId?: string) => void;
}) {
  if (section === "discover")
    return <ConnectedCreatorStudio onPrompt={onPrompt} />;
  if (section === "ideas")
    return (
      <ConnectedIdeas onPrompt={onPrompt} onConversation={onConversation} />
    );
  if (section === "goals") return <ConnectedGoals onPrompt={onPrompt} />;
  if (section === "search")
    return <ConnectedSearch onConversation={onConversation} />;
  if (section === "library") return <ConnectedLibrary onPrompt={onPrompt} />;
  if (section === "feed") return <ConnectedFeed onPrompt={onPrompt} />;
  return null;
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
  const utils = api.useUtils();
  const params = useSearchParams();
  const scope = params.get("space") ?? "personal";
  const proposals = useMemo(
    () =>
      companionKnowledgeData(
        getUntypedClient(utils.client),
        scope,
        () => crypto.randomUUID(),
        () => {
          void utils.workspaces.files.invalidate();
        }
      ),
    [utils, scope]
  );
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
      proposals={proposals}
      items={(files.data?.files ?? [])
        .filter((file) => !file.startsWith("proposals/knowledge/"))
        .map((file) => ({
          id: file,
          title: file.split("/").at(-1) ?? file,
          description: file,
        }))}
      onOpen={setPath}
      onCreate={(kind) => {
        onPrompt(
          kind === "model"
            ? "Help me create an analysis model. Ask what I want to analyze, then use workspace-knowledge-propose to propose the Malloy source in knowledge/models/ together with its definition and evidence. I will review and publish the proposal in my library."
            : "Help me create a document. Ask what I want to make, then save the finished file in my workspace knowledge folder so I can find it in my library."
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
}: {
  readonly onPrompt: (text: string) => void;
}) {
  const { client } = api.useUtils();
  const params = useSearchParams();
  const data = useMemo(
    () => companionFeedData(getUntypedClient(client)),
    [client]
  );
  return (
    <FeedCollection
      data={data}
      cacheScope={params.get("space") ?? "personal"}
      onPrompt={onPrompt}
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

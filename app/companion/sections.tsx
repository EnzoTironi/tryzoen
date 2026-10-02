"use client";
import { ConnectedCreatorStudio } from "./settings/creators";
import { ConnectedSearch } from "./search";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import {
  companionKnowledgeData,
  companionOntologyData,
} from "@shared/companion/knowledge";
import { authClient } from "@web/auth/client";
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
  const cache = useQueryClient();
  const utils = api.useUtils();
  const params = useSearchParams();
  const scope = params.get("space") ?? "personal";
  const account = authClient.useSession();
  const knowledgeScope = `${account.data?.session.id ?? "signed-out"}:${scope}`;
  const ontology = useMemo(
    () =>
      companionOntologyData(
        getUntypedClient(utils.client),
        knowledgeScope,
        () => crypto.randomUUID(),
        () => {
          void utils.workspaces.files.invalidate();
          void cache.invalidateQueries({
            queryKey: ["ontology", knowledgeScope],
          });
        }
      ),
    [utils, knowledgeScope, cache]
  );
  const proposals = useMemo(
    () =>
      companionKnowledgeData(
        getUntypedClient(utils.client),
        knowledgeScope,
        () => crypto.randomUUID(),
        () => {
          void utils.workspaces.files.invalidate();
          void cache.invalidateQueries({ queryKey: ontology.cacheKey });
        }
      ),
    [utils, knowledgeScope, cache, ontology]
  );
  const files = api.workspaces.files.useQuery({});
  const [path, setPath] = useState<string>();
  const library = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const target = returnFocus.current;
    if (path !== undefined || !target) return undefined;
    returnFocus.current = null;
    // Restore after the editor portal finishes its own close/focus cleanup.
    const frame = requestAnimationFrame(() => {
      if (target.isConnected) target.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [path]);
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div
        ref={library}
        inert={path !== undefined}
        aria-hidden={path !== undefined}
        style={{ visibility: path !== undefined ? "hidden" : undefined }}
        className="flex min-h-0 min-w-0 flex-1"
      >
        <Library
          proposals={proposals}
          ontology={ontology}
          items={(files.data?.files ?? [])
            .filter((file) => !file.startsWith("proposals/knowledge/"))
            .map((file) => ({
              id: file,
              title: file.split("/").at(-1) ?? file,
              description: file,
            }))}
          onOpen={(next) => {
            const active = document.activeElement;
            returnFocus.current =
              active instanceof HTMLElement && library.current?.contains(active)
                ? active
                : null;
            setPath(next);
          }}
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
      </div>
      {path !== undefined && (
        <div className="absolute inset-0 flex min-h-0 min-w-0">
          <ConnectedFile
            key={path}
            path={path}
            onClose={() => {
              setPath(undefined);
            }}
          />
        </div>
      )}
    </div>
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

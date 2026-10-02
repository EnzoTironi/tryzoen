import { useI18n } from "@zoen/companion-ui/i18n";
import { MobileSettings } from "./settings";
import { SearchSection } from "./search";
import { randomUUID } from "expo-crypto";
import { useRef, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionButton,
  DiscoverBots,
  CompanionPage,
  DocumentEditor,
  FeedCollection,
  GoalCollection,
  IdeaCollection,
  Library,
  type CompanionSection,
} from "@zoen/companion-ui";
import {
  companionKnowledgeData,
  companionOntologyData,
} from "../../../shared/companion/knowledge";
import { companionFeedData } from "../../../shared/companion/feed";
import { companionIdeasData } from "../../../shared/companion/ideas";
import { client } from "./conversation";
import { queries, rpc } from "./api";
import { auth } from "./auth";
import { companionGoalsData } from "../../../shared/companion/goals";
import { companionDocumentHistory } from "../../../shared/companion/files";
import { shareFile } from "./files/share";
import { companionCreatorData } from "../../../shared/companion/creators";

const mobileCreators = companionCreatorData(
  rpc,
  randomUUID,
  shareFile,
  client.sessions
);

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
  if (section === "discover") return <MobileDiscover onPrompt={onPrompt} />;
  if (section === "ideas")
    return <IdeasSection onPrompt={onPrompt} onConversation={onConversation} />;
  if (section === "search")
    return <SearchSection onConversation={onConversation} />;
  if (section === "goals") return <GoalsSection onPrompt={onPrompt} />;
  if (section === "feed") return <FeedSection onPrompt={onPrompt} />;
  if (section === "library") return <LibrarySection onPrompt={onPrompt} />;
  return (
    <MobileSettings
      onSignOut={onSignOut}
      onPrompt={onPrompt}
      onClose={() => {
        onConversation();
      }}
      creators={mobileCreators}
    />
  );
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
}: {
  readonly onPrompt: (text: string) => void;
}) {
  const session = auth.useSession();
  return (
    <FeedCollection
      data={mobileFeed}
      cacheScope={session.data?.user.id ?? "anonymous"}
      onPrompt={onPrompt}
    />
  );
}
const mobileFeed = companionFeedData(rpc);

function LibrarySection({
  onPrompt,
}: {
  readonly onPrompt: (text: string) => void;
}) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const session = auth.useSession();
  const scope = session.data?.session.id ?? "signed-out";
  const ontology = useMemo(
    () =>
      companionOntologyData(rpc, scope, randomUUID, () => {
        void cache.invalidateQueries({ queryKey: ["files"] });
        void cache.invalidateQueries({ queryKey: ["ontology", scope] });
      }),
    [scope, cache]
  );
  const proposals = useMemo(
    () =>
      companionKnowledgeData(rpc, scope, randomUUID, () => {
        void cache.invalidateQueries({ queryKey: ["files"] });
        void cache.invalidateQueries({ queryKey: ontology.cacheKey });
      }),
    [cache, scope, ontology]
  );
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
      proposals={proposals}
      ontology={ontology}
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
            ? t(
                "Help me create an analysis model. Ask what I want to analyze, then use workspace-knowledge-propose to propose the Malloy source in knowledge/models/ together with its definition and evidence. I will review and publish the proposal in my library."
              )
            : t(
                "Help me create a document. Ask what I want to make, then save the finished file in my workspace knowledge folder."
              )
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
  const { t } = useI18n();
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
        label={t("File content")}
        description={t("Only this workspace can access this document.")}
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
          {t("Back")}
        </ActionButton>
      }
    >
      {null}
    </CompanionPage>
  );
}

function MobileDiscover({
  onPrompt,
}: {
  readonly onPrompt: (prompt: string) => void;
}) {
  const account = auth.useSession();
  return (
    <DiscoverBots
      data={mobileCreators}
      cacheScope={account.data?.user.id ?? "anonymous"}
      onPrompt={onPrompt}
    />
  );
}

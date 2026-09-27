"use client";
import { browserSessionClient } from "@web/eve/client";
import dynamic from "next/dynamic";

import { useRouter, useSearchParams } from "next/navigation";
import {
  CompanionShell,
  CompanionOverlayProvider,
  MarkdownEditorProvider,
  SessionConversation,
  NewConversation,
  type CompanionSection,
  type MarkdownEditorProps,
} from "@zoen/companion-ui";
import { api } from "@web/trpc/client";
import { workspaceHref } from "@web/workspaces/navigation";
import styles from "./companion.module.css";

import { ConnectedSections } from "./sections";
import {
  ConnectedAgentPanel,
  ConnectedAgentHeader,
  ConnectedAgentName,
} from "./agent-panel";
import { renderWebCompanionOverlay } from "./overlay";
const RichTextEditor = dynamic(() => import("./editor/rich-text"), {
  ssr: false,
});

const sections: readonly CompanionSection[] = [
  "chat",
  "search",
  "feed",
  "ideas",
  "goals",
  "library",
  "settings",
];

function renderMarkdownEditor(props: MarkdownEditorProps) {
  return <RichTextEditor {...props} />;
}

export function ConnectedCompanion({
  sessionId,
  title,
}: {
  readonly sessionId?: string;
  readonly title?: string;
}) {
  const router = useRouter();
  const { mutateAsync: saveChat } = api.chats.save.useMutation();
  const params = useSearchParams();
  const workspaceId = params.get("space");
  const view = params.get("view");
  const section = sections.find((candidate) => candidate === view) ?? "chat";
  const draft = (params.get("draft") ?? "").slice(0, 10000);
  const navigate = (path: string) => {
    router.push(workspaceHref(path, workspaceId));
  };
  return (
    <div className={styles.viewport}>
      <CompanionOverlayProvider renderOverlay={renderWebCompanionOverlay}>
        <MarkdownEditorProvider value={renderMarkdownEditor}>
          <CompanionShell
            section={section}
            title={title ?? "Zoen"}
            avatarUri="/marketing/zoen-avatar.webp"
            agentName={<ConnectedAgentName />}
            renderAgentHeader={(onEdit) => (
              <ConnectedAgentHeader onEdit={onEdit} />
            )}
            renderAgentPanel={(tab, close) => (
              <ConnectedAgentPanel
                tab={tab}
                onPrompt={(prompt) => {
                  close();
                  navigate(`/companion?draft=${encodeURIComponent(prompt)}`);
                }}
                onConversation={(id) => {
                  close();
                  navigate(`/companion/${encodeURIComponent(id)}`);
                }}
              />
            )}
            onNavigate={(nextSection) => {
              navigate(
                `/companion${sessionId ? `/${encodeURIComponent(sessionId)}` : ""}?view=${nextSection}`
              );
            }}
            onNewConversation={() => {
              navigate("/companion");
            }}
          >
            {section !== "chat" ? (
              <ConnectedSections
                section={section}
                onPrompt={(prompt) => {
                  navigate(`/companion?draft=${encodeURIComponent(prompt)}`);
                }}
                onConversation={(id) => {
                  navigate(
                    id ? `/companion/${encodeURIComponent(id)}` : "/companion"
                  );
                }}
              />
            ) : sessionId ? (
              <SessionConversation
                sessionId={sessionId}
                client={browserSessionClient}
              />
            ) : (
              <NewConversation
                key={draft}
                client={browserSessionClient}
                avatarUri="/marketing/zoen-avatar.webp"
                save={(id, name) => saveChat({ sessionId: id, title: name })}
                initialDraft={draft}
                onCreated={(id) => {
                  router.replace(
                    workspaceHref(
                      `/companion/${encodeURIComponent(id)}`,
                      workspaceId
                    )
                  );
                }}
              />
            )}
          </CompanionShell>
        </MarkdownEditorProvider>
      </CompanionOverlayProvider>
    </div>
  );
}

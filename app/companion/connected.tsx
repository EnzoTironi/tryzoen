"use client";
import { browserSessionClient } from "@web/eve/client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  writeConversationDraft,
  readConversationDraft,
  forgetConversationDraft,
} from "./drafts";

import { useRouter, useSearchParams } from "next/navigation";
import {
  CompanionShell,
  CompanionOverlayProvider,
  MarkdownEditorProvider,
  SessionConversation,
  NewConversation,
  AttachmentProvider,
  type CompanionSection,
  type MarkdownEditorProps,
} from "@zoen/companion-ui";
import { api } from "@web/trpc/client";
import { getUntypedClient } from "@trpc/client";
import { companionReactionData } from "@shared/companion/reactions";
import { workspaceHref } from "@web/workspaces/navigation";
import styles from "./companion.module.css";
import {
  pickBrowserAttachments,
  saveBrowserAttachment,
} from "@web/files/attachments";

import { ConnectedSections } from "./sections";
import {
  ConnectedAgentPanel,
  ConnectedAgentHeader,
  ConnectedAgentName,
} from "./agent-panel";
import { renderWebCompanionOverlay } from "./overlay";
const RichTextEditor = dynamic(
  () => import("@web/components/markdown-editor/rich-text"),
  {
    ssr: false,
  }
);

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
  draftScope,
}: {
  readonly sessionId?: string;
  readonly title?: string;
  readonly draftScope: string;
}) {
  const router = useRouter();
  const { client } = api.useUtils();
  const reactions = useMemo(
    () => companionReactionData(getUntypedClient(client)),
    [client]
  );
  const { mutateAsync: saveChat } = api.chats.save.useMutation();
  const params = useSearchParams();
  const workspaceId = params.get("space");
  const view = params.get("view");
  const section = sections.find((candidate) => candidate === view) ?? "chat";
  const token = params.get("draft");
  const draft = useMemo(
    () => readConversationDraft(draftScope, token),
    [draftScope, token]
  );
  const [draftError, setDraftError] = useState(false);
  useEffect(() => {
    forgetConversationDraft(draftScope, token);
  }, [draftScope, token]);
  const navigate = (path: string) => {
    router.push(workspaceHref(path, workspaceId));
  };
  const stagePrompt = (prompt: string) => {
    try {
      const draftToken = writeConversationDraft(draftScope, {
        text: prompt,
        files: [],
      });
      setDraftError(false);
      navigate(`/companion?draft=${draftToken}`);
    } catch {
      setDraftError(true);
    }
  };
  return (
    <div className={styles.viewport}>
      {draftError && (
        <p role="alert">
          Couldn’t open the draft. Allow storage for this site and try again.
        </p>
      )}
      <CompanionOverlayProvider renderOverlay={renderWebCompanionOverlay}>
        <MarkdownEditorProvider value={renderMarkdownEditor}>
          <AttachmentProvider
            pick={pickBrowserAttachments}
            save={saveBrowserAttachment}
          >
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
                    stagePrompt(prompt);
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
                  onPrompt={stagePrompt}
                  onConversation={(id) => {
                    navigate(
                      id ? `/companion/${encodeURIComponent(id)}` : "/companion"
                    );
                  }}
                />
              ) : sessionId ? (
                <SessionConversation
                  key={`${draftScope}:${sessionId}`}
                  reactions={reactions}
                  cacheScope={draftScope}
                  sessionId={sessionId}
                  initialDraft={draft}
                  client={browserSessionClient}
                  onCopyText={(text) => navigator.clipboard.writeText(text)}
                />
              ) : (
                <NewConversation
                  key={token}
                  client={browserSessionClient}
                  avatarUri="/marketing/zoen-avatar.webp"
                  save={(id, name) => saveChat({ sessionId: id, title: name })}
                  initialDraft={draft}
                  onCreated={(id, retainedDraft) => {
                    const retainedToken = retainedDraft
                      ? writeConversationDraft(draftScope, retainedDraft)
                      : undefined;
                    router.replace(
                      workspaceHref(
                        `/companion/${encodeURIComponent(id)}${retainedToken ? `?draft=${retainedToken}` : ""}`,
                        workspaceId
                      )
                    );
                  }}
                />
              )}
            </CompanionShell>
          </AttachmentProvider>
        </MarkdownEditorProvider>
      </CompanionOverlayProvider>
    </div>
  );
}

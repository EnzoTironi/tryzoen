"use client";
import { useState } from "react";
import { writeConversationDraft } from "./drafts";

import { useRouter, useSearchParams } from "next/navigation";
import {
  CompanionShell,
  AttachmentProvider,
  type CompanionSection,
} from "@zoen/companion-ui";
import { ConnectedConversation } from "./conversation";
import { workspaceHref } from "@web/workspaces/navigation";
import styles from "./companion.module.css";
import {
  pickBrowserAttachments,
  saveBrowserAttachment,
} from "@web/files/attachments";

import { ConnectedInbox, ConnectedRoom } from "./inbox";
import { ConnectedSections } from "./sections";
import { ConnectedSettings } from "./settings";
import {
  ConnectedAgentPanel,
  ConnectedAgentHeader,
  ConnectedAgentName,
} from "./agent-panel";
import { CompanionEditingProvider } from "./editing";
const sections: readonly CompanionSection[] = [
  "chat",
  "search",
  "feed",
  "ideas",
  "goals",
  "library",
  "discover",
];

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
  const params = useSearchParams();
  const workspaceId = params.get("space");
  const view = params.get("view");
  const section = sections.find((candidate) => candidate === view) ?? "chat";
  const token = params.get("draft");
  const roomId = params.get("room");
  const conversationOpen = Boolean(
    sessionId ?? roomId ?? token ?? params.get("compose")
  );
  const [draftError, setDraftError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = (path: string) => {
    router.push(workspaceHref(path, workspaceId));
  };
  const openConversation = (id?: string) => {
    navigate(
      id ? `/companion/${encodeURIComponent(id)}` : "/companion?compose=1"
    );
  };
  const navigateSection = (next: CompanionSection) => {
    if (next === "settings") setSettingsOpen(true);
    else navigate(`/companion?view=${next}`);
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
      <CompanionEditingProvider>
        <AttachmentProvider
          pick={pickBrowserAttachments}
          save={saveBrowserAttachment}
        >
          <CompanionShell
            section={section}
            conversationOpen={conversationOpen}
            onShowInbox={() => {
              navigate("/companion");
            }}
            hideConversationHeader={Boolean(roomId)}
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
                  openConversation(id);
                }}
              />
            )}
            renderConversations={() => (
              <ConnectedInbox
                cacheScope={draftScope}
                workspaceId={workspaceId}
                selectedId={sessionId}
                selectedRoom={roomId ?? undefined}
                onOpen={openConversation}
                onCreate={() => {
                  openConversation();
                }}
                onOpenRoom={(id) => {
                  navigate(`/companion?room=${encodeURIComponent(id)}`);
                }}
                onDiscover={() => {
                  navigate("/companion?view=discover");
                }}
              />
            )}
            onNavigate={navigateSection}
            onNewConversation={() => {
              openConversation();
            }}
          >
            {section !== "chat" ? (
              <ConnectedSections
                section={section}
                onPrompt={stagePrompt}
                onConversation={openConversation}
              />
            ) : roomId ? (
              <ConnectedRoom
                key={`${draftScope}:${roomId}`}
                roomId={roomId}
                cacheScope={draftScope}
                onBack={() => {
                  navigate("/companion");
                }}
              />
            ) : (
              <ConnectedConversation
                sessionId={sessionId}
                draftScope={draftScope}
              />
            )}
          </CompanionShell>
          {settingsOpen && (
            <ConnectedSettings
              onClose={() => {
                setSettingsOpen(false);
              }}
              onPrompt={stagePrompt}
            />
          )}
        </AttachmentProvider>
      </CompanionEditingProvider>
    </div>
  );
}

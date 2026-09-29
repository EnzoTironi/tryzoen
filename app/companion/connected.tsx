"use client";
import { startBrowserAudioRecording } from "@web/files/audio-recording";
import { renderBrowserMedia } from "@web/files/media";
import { api } from "@web/trpc/client";
import { useState } from "react";
import { writeConversationDraft } from "./drafts";

import { useRouter, useSearchParams } from "next/navigation";
import {
  CompanionShell,
  AttachmentProvider,
  LinkPreviewProvider,
  ComposerReferenceProvider,
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
import { parseRoomMessageLocation } from "@zoen/companion-ui";
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
  const { client } = api.useUtils();
  const router = useRouter();
  const params = useSearchParams();
  const workspaceId = params.get("space");
  const view = params.get("view");
  const section = sections.find((candidate) => candidate === view) ?? "chat";
  const token = params.get("draft");
  const roomId = params.get("room");
  const messageLocation = parseRoomMessageLocation(params);
  const conversationOpen = Boolean(
    sessionId ?? roomId ?? token ?? params.get("compose")
  );
  const [draftError, setDraftError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = (path: string) => {
    const href = workspaceHref(path, workspaceId);
    if (
      new URL(href, window.location.origin).pathname ===
      window.location.pathname
    )
      window.history.pushState(null, "", href);
    else router.push(href, { scroll: false });
  };
  const openConversation = (id?: string) => {
    navigate(
      id ? `/companion/${encodeURIComponent(id)}` : "/companion?compose=1"
    );
  };
  const navigateSection = (next: CompanionSection) => {
    if (next === "settings") setSettingsOpen(true);
    else {
      const query = new URLSearchParams(params);
      query.set("view", next);
      window.history.pushState(
        null,
        "",
        `${window.location.pathname}?${query.toString()}`
      );
    }
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
      {params.has("message") && !messageLocation && (
        <p role="alert">Este link de mensagem é inválido.</p>
      )}
      {draftError && (
        <p role="alert">
          Couldn’t open the draft. Allow storage for this site and try again.
        </p>
      )}
      <CompanionEditingProvider>
        <AttachmentProvider
          pick={pickBrowserAttachments}
          save={saveBrowserAttachment}
          renderMedia={renderBrowserMedia}
          startAudioRecording={startBrowserAudioRecording}
        >
          <LinkPreviewProvider
            cacheScope={draftScope}
            load={(url) => client.workspaces.linkPreview.query({ url })}
          >
            <ComposerReferenceProvider
              cacheScope={draftScope}
              roomId={roomId ?? undefined}
              search={(input) => client.workspaces.references.query(input)}
            >
              <CompanionShell
                section={section}
                contentVisible={!settingsOpen}
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
                    cacheScope={draftScope}
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
                    selectedMessage={messageLocation?.messageId}
                    onCloseMessage={() => {
                      const query = new URLSearchParams(params);
                      query.delete("message");
                      window.history.replaceState(
                        null,
                        "",
                        `${window.location.pathname}?${query.toString()}`
                      );
                    }}
                    key={`${draftScope}:${roomId}`}
                    roomId={roomId}
                    onOpenRoom={(id) => {
                      navigate(`/companion?room=${encodeURIComponent(id)}`);
                    }}
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
            </ComposerReferenceProvider>
          </LinkPreviewProvider>
        </AttachmentProvider>
      </CompanionEditingProvider>
    </div>
  );
}

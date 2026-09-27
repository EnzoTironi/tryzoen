"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEveAgent } from "eve/react";
import {
  CompanionShell,
  Conversation,
  Welcome,
  type CompanionSection,
} from "@zoen/companion-ui";
import { api } from "@web/trpc/client";
import {
  browserWorkspaceHeaders,
  workspaceHref,
} from "@web/workspaces/navigation";
import { useSessionAgent } from "@app/(authenticated)/chat/[sessionId]/_components/use-session-agent";
import styles from "./companion.module.css";

const sectionPaths: Record<CompanionSection, string> = {
  chat: "/companion",
  search: "/chat/history",
  feed: "/insights",
  ideas: "/recipes",
  goals: "/tasks",
  library: "/space/knowledge",
  settings: "/account",
};

export function ConnectedCompanion({
  sessionId,
  title,
}: {
  readonly sessionId?: string;
  readonly title?: string;
}) {
  const router = useRouter();
  const workspaceId = useSearchParams().get("space");
  const navigate = (path: string) => {
    router.push(workspaceHref(path, workspaceId));
  };
  return (
    <div className={styles.viewport}>
      <CompanionShell
        title={title ?? "Zoen"}
        avatarUri="/marketing/zoen-avatar.webp"
        onNavigate={(section) => {
          navigate(sectionPaths[section]);
        }}
        onNewConversation={() => {
          navigate("/companion");
        }}
      >
        {sessionId ? (
          <ExistingConversation sessionId={sessionId} />
        ) : (
          <NewConversation
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
    </div>
  );
}

function ExistingConversation({ sessionId }: { readonly sessionId: string }) {
  const agent = useSessionAgent(sessionId);
  const [actionError, setActionError] = useState<string>();
  const busy = agent.status === "streaming" || agent.status === "submitted";
  return (
    <Conversation
      messages={agent.data.messages}
      status={agent.status}
      error={actionError ?? agent.error?.message}
      onSend={(text) =>
        agent.send(text, busy ? { turnPolicy: "steer" } : undefined)
      }
      onRespond={agent.respond}
      onCancel={() => {
        setActionError(undefined);
        void agent.cancel().catch(() => {
          setActionError("The stop request failed. Please try again.");
        });
      }}
      onLoadOlder={
        agent.hasOlder
          ? () => {
              setActionError(undefined);
              void agent.loadOlder().catch(() => {
                setActionError(
                  "Earlier messages couldn’t be loaded. Please try again."
                );
              });
            }
          : undefined
      }
      loadingOlder={agent.isLoadingOlder}
    />
  );
}

function NewConversation({
  onCreated,
}: {
  readonly onCreated: (id: string) => void;
}) {
  const { mutateAsync: saveChat } = api.chats.save.useMutation();
  const title = useRef<string | undefined>(undefined);
  const sendError = useRef<Error | undefined>(undefined);
  const saved = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const agent = useEveAgent({
    headers: browserWorkspaceHeaders,
    onError(error) {
      sendError.current = error;
    },
    onSessionChange(session) {
      if (!session || saved.current) return;
      saved.current = true;
      void saveChat({
        sessionId: session.sessionId,
        title: title.current,
      }).then(
        () => {
          onCreated(session.sessionId);
        },
        () => {
          setSaveError(true);
        }
      );
    },
  });
  const [actionError, setActionError] = useState<string>();
  const busy = agent.status === "streaming" || agent.status === "submitted";
  const send = async (text: string) => {
    sendError.current = undefined;
    title.current ??= text.slice(0, 240);
    await agent.send(text, busy ? { turnPolicy: "steer" } : undefined);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Eve's onError callback updates the ref while send awaits.
    if (sendError.current) throw sendError.current;
  };
  if (agent.session || saveError) {
    return (
      <Conversation
        messages={agent.data.messages}
        status={agent.status}
        error={
          saveError
            ? "Your conversation is running, but it couldn’t be added to history. Keep this window open."
            : (actionError ?? agent.error?.message)
        }
        onSend={send}
        onRespond={agent.respond}
        onCancel={() => {
          void agent.cancel().catch(() => {
            setActionError("The stop request failed. Please try again.");
          });
        }}
      />
    );
  }
  return (
    <Welcome
      avatarUri="/marketing/zoen-avatar.webp"
      onSend={send}
      disabled={agent.status === "resuming"}
    />
  );
}

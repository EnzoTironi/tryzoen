"use client";
import { browserSessionClient } from "@web/eve/client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@web/auth/client";
import type { ChatUsage } from "@shared/chat/schema";
import type { TraceView } from "../_lib/trace-view";
import { SubagentPanel } from "./activity";
import { ChatConversation } from "./conversation";
import { ChatInput } from "./input";
import { useSessionAgent } from "@zoen/companion-ui/session";

export function ChatSession({
  initialUsage,
  sessionId,
}: {
  readonly initialUsage?: ChatUsage;
  readonly sessionId: string;
}) {
  const account = authClient.useSession();
  const params = useSearchParams();
  const cacheScope = `${account.data?.user.id ?? "anonymous"}:${account.data?.session.id ?? "signed-out"}:${params.get("space") ?? "personal"}`;
  return (
    <OwnedChatSession
      key={`${cacheScope}:${sessionId}`}
      cacheScope={cacheScope}
      initialUsage={initialUsage}
      sessionId={sessionId}
    />
  );
}
function OwnedChatSession({
  initialUsage,
  sessionId,
  cacheScope,
}: {
  readonly initialUsage?: ChatUsage;
  readonly sessionId: string;
  readonly cacheScope: string;
}) {
  const [traceView, setTraceView] = useState<TraceView>("imessage");
  const agent = useSessionAgent(sessionId, browserSessionClient, cacheScope);

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-background text-foreground">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <ChatConversation
          agent={agent}
          initial={false}
          history={{
            hasOlder: agent.hasOlder,
            isLoadingOlder: agent.isLoadingOlder,
            loadOlder: agent.loadOlder,
            olderError: agent.olderError,
          }}
          sessionId={sessionId}
          traceView={traceView}
        />
        <ChatInput agent={agent} sessionId={sessionId} />
      </div>
      <SubagentPanel
        events={agent.events}
        historyComplete={!agent.hasOlder}
        initialUsage={initialUsage}
        onTraceViewChange={setTraceView}
        sessionId={sessionId}
        traceView={traceView}
      />
    </div>
  );
}

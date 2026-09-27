"use client";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import {
  AgentPanelContent,
  PersonalMemorySection,
  type AgentPanelTab,
} from "@zoen/companion-ui";
import { companionAgentData } from "@shared/companion/agent-data";
import { api } from "@web/trpc/client";
import { browserSessionClient } from "@web/eve/client";
import { ConnectedSearch } from "./search";

function useAgentData() {
  const { client } = api.useUtils();
  const params = useSearchParams();
  const data = useMemo(
    () => companionAgentData(getUntypedClient(client)),
    [client]
  );
  return { data, cacheScope: params.get("space") ?? "personal" };
}
export function ConnectedAgentPanel(props: {
  readonly tab: AgentPanelTab;
  readonly onPrompt: (text: string) => void;
  readonly onConversation: (id: string) => void;
}) {
  const connection = useAgentData();
  return (
    <AgentPanelContent
      {...props}
      {...connection}
      client={browserSessionClient}
      renderConversations={(options) => <ConnectedSearch {...options} />}
    />
  );
}
export function ConnectedMemory({
  onPrompt,
}: {
  readonly onPrompt: (text: string) => void;
}) {
  const connection = useAgentData();
  return <PersonalMemorySection {...connection} onPrompt={onPrompt} />;
}

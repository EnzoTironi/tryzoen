"use client";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import {
  AgentPanelContent,
  PersonalMemorySection,
  type AgentPanelTab,
  AgentPresence,
  AgentName,
} from "@zoen/companion-ui";
import { companionAgentData } from "@shared/companion/agent-data";
import { api } from "@web/trpc/client";
import { browserSessionClient } from "@web/eve/client";
import { downloadMemoryBackup } from "@web/files/download";

function useAgentData() {
  const { client } = api.useUtils();
  const params = useSearchParams();
  const space = params.get("space");
  const data = useMemo(
    () =>
      companionAgentData(
        getUntypedClient(client),
        () => crypto.randomUUID(),
        () => downloadMemoryBackup(window.location.origin, space)
      ),
    [client, space]
  );
  return { data, cacheScope: space ?? "personal" };
}
export function ConnectedAgentName() {
  return <AgentName {...useAgentData()} />;
}
export function ConnectedAgentHeader({
  onEdit,
}: {
  readonly onEdit: () => void;
}) {
  const connection = useAgentData();
  return (
    <AgentPresence
      {...connection}
      client={browserSessionClient}
      avatarUri="/marketing/zoen-avatar.webp"
      onEdit={onEdit}
    />
  );
}
export function ConnectedAgentPanel(props: {
  readonly cacheScope: string;
  readonly tab: AgentPanelTab;
  readonly onPrompt: (text: string) => void;
  readonly onConversation: (id: string) => void;
}) {
  const connection = useAgentData();
  return (
    <AgentPanelContent
      {...connection}
      {...props}
      client={browserSessionClient}
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

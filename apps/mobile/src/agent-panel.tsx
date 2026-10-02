import {
  AgentPanelContent,
  PersonalMemorySection,
  type AgentPanelTab,
  AgentPresence,
  AgentName,
} from "@zoen/companion-ui";
import { randomUUID } from "expo-crypto";
import { apiOrigin } from "./environment";
import { companionAgentData } from "../../../shared/companion/agent-data";
import { client } from "./conversation";
import { rpc } from "./api";
import { exportMemory, inspectMemory } from "./files/memory";

const data = companionAgentData(rpc, randomUUID, {
  backup: exportMemory,
  inspect: inspectMemory,
});
export function MobileAgentName() {
  return <AgentName data={data} cacheScope="personal" />;
}
export function MobileAgentHeader({ onEdit }: { readonly onEdit: () => void }) {
  return (
    <AgentPresence
      data={data}
      cacheScope="personal"
      client={client}
      avatarUri={`${apiOrigin}/marketing/zoen-avatar.webp`}
      onEdit={onEdit}
    />
  );
}
export function MobileAgentPanel(props: {
  readonly tab: AgentPanelTab;
  readonly onPrompt: (text: string) => void;
  readonly onConversation: (id: string) => void;
}) {
  return (
    <AgentPanelContent
      {...props}
      data={data}
      cacheScope="personal"
      client={client}
    />
  );
}
export function MobileMemory({
  onPrompt,
}: {
  readonly onPrompt: (text: string) => void;
}) {
  return (
    <PersonalMemorySection
      data={data}
      cacheScope="personal"
      onPrompt={onPrompt}
    />
  );
}

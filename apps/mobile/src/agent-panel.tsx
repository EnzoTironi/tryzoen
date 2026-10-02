import { useMemo } from "react";
import { useI18n } from "@zoen/companion-ui/i18n";
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

function useAgentData() {
  const { locale, t } = useI18n();
  return useMemo(
    () =>
      companionAgentData(
        rpc,
        randomUUID,
        { backup: exportMemory, inspect: inspectMemory },
        { locale, t }
      ),
    [locale, t]
  );
}
export function MobileAgentName() {
  const data = useAgentData();
  return <AgentName data={data} cacheScope="personal" />;
}
export function MobileAgentHeader({ onEdit }: { readonly onEdit: () => void }) {
  const data = useAgentData();
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
  const data = useAgentData();
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
  const data = useAgentData();
  return (
    <PersonalMemorySection
      data={data}
      cacheScope="personal"
      onPrompt={onPrompt}
    />
  );
}

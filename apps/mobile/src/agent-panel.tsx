import {
  AgentPanelContent,
  PersonalMemorySection,
  type AgentPanelTab,
} from "@zoen/companion-ui";
import { companionAgentData } from "../../../shared/companion/agent-data";
import { SearchSection } from "./search";
import { client } from "./conversation";
import { rpc } from "./api";

const data = companionAgentData(rpc);
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
      renderConversations={(options) => <SearchSection {...options} />}
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

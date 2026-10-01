export { CompanionShell, type CompanionSection } from "./shell";
export { SettingsPanel, type SettingsPage } from "./settings";
export { CreatorStudio, type CreatorStudioData } from "./creators/studio";
export { Composer } from "./composer";
export { AttachmentProvider } from "./attachments/provider";
export { Welcome } from "./welcome";
export { ActionButton } from "./button";
export { Conversation } from "./conversation";

export { IdeaCollection, type IdeasData } from "./ideas/collection";
export { Goals } from "./goals";
export { GoalCollection, type GoalsData } from "./goals/collection";
export { Library } from "./library";
export { FeedCollection, type FeedData } from "./feed/collection";
export { ConversationSearch } from "./chats/collection";
export { CompanionPage } from "./page";
export { NewConversation } from "./new-conversation";
export { SessionConversation } from "./session-conversation";
export { AgentPanel, type AgentPanelTab } from "./agent-panel";
export { AgentPresence, AgentName } from "./agent-identity";
export {
  MarkdownEditorProvider,
  type MarkdownEditorHandle,
  type MarkdownEditorProps,
} from "./markdown-editor";
export { Upcoming } from "./upcoming";
export { PersonalMemory } from "./personal-memory";
export { ConversationReview } from "./conversation-review";
export {
  AgentPanelContent,
  PersonalMemorySection,
  type AgentPanelData,
} from "./agent-content";
export {
  CompanionOverlayProvider,
  type CompanionOverlayProps,
} from "./overlay";

export { MarkdownSourceEditor } from "./editor/source";
export { DocumentEditor } from "./document-editor";
export { MemoryRelations } from "./learned/relations";
export type { DocumentHistoryData } from "./document-history";

export { ConversationInbox } from "./chats/inbox";
export { RoomConversation } from "./rooms/conversation";
export { roomMessageUrl, parseRoomMessageLocation } from "./rooms/links";
export { DiscoverBots } from "./creators/discover";

export { ComposerReferenceProvider } from "./references/provider";

export { LinkPreviewProvider } from "./cards/provider";

export {
  ComposerEditorProvider,
  type ComposerEditorProps,
  type ComposerEditorHandle,
} from "./composer/editor";
export { VaultCollection } from "./vault/collection";
export { VaultItemForm } from "./vault/form";
export type { VaultData } from "./vault/data";

export {
  GesturePreferenceProvider,
  MessageGestureSettings,
  type GesturePreferenceStorage,
} from "./conversation/gesture-preferences";

export type { KnowledgeProposalData } from "./library/knowledge";
export type { OntologyData } from "./library/ontology/collection";

export { useAccessibilityPreferences, useDarkAppearance } from "./theme";

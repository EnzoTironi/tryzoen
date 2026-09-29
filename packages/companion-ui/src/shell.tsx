import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SquareCheck,
  Shapes,
  Lightbulb,
  MessageCircle,
  Search,
  Menu,
  SquarePen,
  ArrowLeft,
  Compass,
  PanelsTopLeft,
} from "lucide-react-native";
import { IconButton } from "./icon-button";
import { colors } from "./theme";
import { AgentPanel, type AgentPanelTab } from "./agent-panel";
import { ConversationNavigation } from "./chats/navigation";
import { CompanionVisibility } from "./visibility";

const sections = [
  { id: "chat", label: "Conversation", icon: MessageCircle },
  { id: "search", label: "Search", icon: Search },
  { id: "feed", label: "Feed", icon: PanelsTopLeft },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
  { id: "goals", label: "Goals", icon: SquareCheck },
  { id: "library", label: "Library", icon: Shapes },
  { id: "discover", label: "Descobrir", icon: Compass },
] as const;

export type CompanionSection =
  | "chat"
  | "search"
  | "feed"
  | "ideas"
  | "goals"
  | "library"
  | "settings"
  | "discover";

export function CompanionShell({
  children,
  section = "chat",
  title = "Zoen",
  avatarUri,
  agentName = "Zoen",
  onNavigate,
  onNewConversation,
  renderAgentPanel,
  renderAgentHeader,
  renderConversations,
  conversationOpen = false,
  onShowInbox,
  hideConversationHeader = false,
  contentVisible = true,
}: {
  readonly children: ReactNode;
  readonly conversationOpen?: boolean;
  readonly onShowInbox?: () => void;
  readonly hideConversationHeader?: boolean;
  readonly contentVisible?: boolean;
  readonly section?: CompanionSection;
  readonly title?: string;
  readonly avatarUri?: string;
  readonly agentName?: ReactNode;
  readonly onNavigate: (section: CompanionSection) => void;
  readonly onNewConversation: () => void;
  readonly renderAgentPanel?: (
    tab: AgentPanelTab,
    close: () => void
  ) => ReactNode;
  readonly renderAgentHeader?: (onEdit: () => void) => ReactNode;
} & Pick<
  ComponentProps<typeof ConversationNavigation>,
  "renderConversations"
>) {
  const compact = useWindowDimensions().width < 720;
  const [showAgent, setShowAgent] = useState(false);
  return (
    <View style={[styles.shell, compact && styles.compact]}>
      {!compact && (
        <View style={styles.rail}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Agent activity and memory"
            onPress={() => {
              setShowAgent(true);
            }}
            style={styles.brand}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <Text style={styles.monogram}>z.</Text>
            )}
          </Pressable>
          <View style={styles.navigation}>
            {sections.map(({ id, label, icon }) => (
              <IconButton
                key={id}
                icon={icon}
                label={label}
                selected={id === section}
                onPress={() => {
                  onNavigate(id);
                }}
              />
            ))}
          </View>
          <IconButton
            label="Settings"
            icon={Menu}
            selected={section === "settings"}
            onPress={() => {
              onNavigate("settings");
            }}
          />
        </View>
      )}
      <CompanionVisibility
        value={contentVisible && (!showAgent || !renderAgentPanel)}
      >
        <ConversationNavigation
          active={section === "chat"}
          renderConversations={renderConversations}
          conversationOpen={conversationOpen}
          onShowInbox={onShowInbox}
        >
          {(toggle) => (
            <View style={styles.body}>
              {section === "chat" && !hideConversationHeader && (
                <CompanionHeader
                  compact={compact}
                  title={title}
                  avatarUri={avatarUri}
                  agentName={agentName}
                  onNewConversation={onNewConversation}
                  onOpenConversations={toggle}
                  onOpenAgent={() => {
                    setShowAgent(true);
                  }}
                />
              )}
              <View style={styles.content}>{children}</View>
            </View>
          )}
        </ConversationNavigation>
      </CompanionVisibility>
      {compact && (
        <View style={styles.bottomBar}>
          {sections
            .filter(({ id }) => id !== "search" && id !== "discover")
            .map(({ id, label, icon }) => (
              <IconButton
                key={id}
                icon={icon}
                label={label}
                selected={id === section}
                onPress={() => {
                  if (id === "chat") onShowInbox?.();
                  onNavigate(id);
                }}
              />
            ))}
          <IconButton
            label="Settings"
            icon={Menu}
            selected={section === "settings"}
            onPress={() => {
              onNavigate("settings");
            }}
          />
        </View>
      )}
      {showAgent && renderAgentPanel && (
        <AgentPanel
          renderHeader={renderAgentHeader}
          onClose={() => {
            setShowAgent(false);
          }}
        >
          {(tab) =>
            renderAgentPanel(tab, () => {
              setShowAgent(false);
            })
          }
        </AgentPanel>
      )}
    </View>
  );
}

function CompanionHeader({
  compact,
  title,
  avatarUri,
  agentName,
  onNewConversation,
  onOpenAgent,
  onOpenConversations,
}: Pick<
  ComponentProps<typeof CompanionShell>,
  "title" | "avatarUri" | "agentName" | "onNewConversation"
> & {
  readonly compact: boolean;
  readonly onOpenAgent: () => void;
  readonly onOpenConversations: () => void;
}) {
  return (
    <View
      accessibilityLabel={title}
      style={[styles.header, compact && styles.mobileHeader]}
    >
      {compact && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar às conversas"
          onPress={onOpenConversations}
          style={styles.chatMenu}
        >
          <ArrowLeft size={20} color={colors.muted} />
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Agent activity and memory"
        onPress={() => {
          onOpenAgent();
        }}
        style={[styles.identity, compact && styles.mobileIdentity]}
      >
        {avatarUri && (
          <Image
            source={{ uri: avatarUri }}
            style={[styles.identityAvatar, compact && styles.mobileAvatar]}
          />
        )}
        <Text
          numberOfLines={1}
          style={[styles.title, compact && styles.mobileTitle]}
        >
          {agentName}
        </Text>
      </Pressable>
      <View style={[styles.headerEnd, compact && styles.mobileHeaderEnd]}>
        <IconButton
          label="New conversation"
          icon={SquarePen}
          onPress={onNewConversation}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: colors.canvas },
  compact: { flexDirection: "column" },
  rail: {
    width: 68,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 22,
    justifyContent: "space-between",
  },
  brand: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  monogram: {
    color: colors.ink,
    fontSize: 34,
    fontWeight: "600",
    letterSpacing: -3,
  },
  navigation: { gap: 10, marginTop: 40, marginBottom: "auto", paddingTop: 8 },
  body: { flex: 1, minWidth: 0 },
  header: {
    minHeight: 78,
    borderBottomWidth: 1,
    borderBottomColor: "#efeff1",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  mobileHeader: {
    minHeight: 78,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: "center",
  },
  chatMenu: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    borderRadius: 24,
    padding: 12,
    backgroundColor: colors.surface,
    boxShadow: "0 3px 12px rgba(0,0,0,0.07)",
  },
  headerEnd: { width: 156, alignItems: "flex-end" },
  mobileHeaderEnd: { width: 44 },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 24,
    flex: 1,
  },
  identityAvatar: { width: 28, height: 28, borderRadius: 14 },
  mobileIdentity: { flexDirection: "row", gap: 8, flex: 1 },
  mobileAvatar: { width: 32, height: 32, borderRadius: 16 },
  mobileTitle: { fontSize: 16 },
  title: {
    textAlign: "center",
    fontSize: 15,
    fontWeight: "500",
    color: colors.ink,
  },
  content: { flex: 1, minHeight: 0 },
  bottomBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 5,
    paddingHorizontal: 5,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 32,
    backgroundColor: colors.surface,
    boxShadow: "0 6px 28px rgba(0,0,0,0.08)",
  },
});

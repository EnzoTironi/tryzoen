import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import {
  Image,
  Platform,
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
  PanelsTopLeft,
} from "lucide-react-native";
import { IconButton } from "./icon-button";
import { colors } from "./theme";
import { AgentPanel, type AgentPanelTab } from "./agent-panel";

const sections = [
  { id: "chat", label: "Conversation", icon: MessageCircle },
  { id: "search", label: "Search", icon: Search },
  { id: "feed", label: "Feed", icon: PanelsTopLeft },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
  { id: "goals", label: "Goals", icon: SquareCheck },
  { id: "library", label: "Library", icon: Shapes },
] as const;

export type CompanionSection =
  | "chat"
  | "search"
  | "feed"
  | "ideas"
  | "goals"
  | "library"
  | "settings";

export function CompanionShell({
  children,
  section = "chat",
  title = "Zoen",
  avatarUri,
  onNavigate,
  onNewConversation,
  renderAgentPanel,
}: {
  readonly children: ReactNode;
  readonly section?: CompanionSection;
  readonly title?: string;
  readonly avatarUri?: string;
  readonly onNavigate: (section: CompanionSection) => void;
  readonly onNewConversation: () => void;
  readonly renderAgentPanel?: (
    tab: AgentPanelTab,
    close: () => void
  ) => ReactNode;
}) {
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
      <View style={styles.body}>
        {(section === "chat" || compact) && (
          <CompanionHeader
            compact={compact}
            title={title}
            avatarUri={avatarUri}
            onNavigate={onNavigate}
            onNewConversation={onNewConversation}
            onOpenAgent={() => {
              setShowAgent(true);
            }}
          />
        )}
        <View style={styles.content}>{children}</View>
      </View>
      {compact && (
        <View style={styles.bottomBar}>
          {sections
            .filter(({ id }) => id !== "search")
            .map(({ id, label, icon }) => (
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
          {Platform.OS === "web" && (
            <IconButton
              label="Settings"
              icon={Menu}
              selected={section === "settings"}
              onPress={() => {
                onNavigate("settings");
              }}
            />
          )}
        </View>
      )}
      {showAgent && renderAgentPanel && (
        <AgentPanel
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
  onNavigate,
  onNewConversation,
  onOpenAgent,
}: Pick<
  ComponentProps<typeof CompanionShell>,
  "title" | "avatarUri" | "onNavigate" | "onNewConversation"
> & { readonly compact: boolean; readonly onOpenAgent: () => void }) {
  const nativeCompact = compact && Platform.OS !== "web";
  return (
    <View
      accessibilityLabel={title}
      style={[styles.header, compact && styles.mobileHeader]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Conversations"
        onPress={() => {
          onNavigate("search");
        }}
        style={styles.chatMenu}
      >
        <Menu size={20} color={colors.muted} />
        {!compact && <Text style={styles.chatMenuLabel}>Conversations</Text>}
      </Pressable>
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
          Zoen
        </Text>
      </Pressable>
      <View style={[styles.headerEnd, compact && styles.mobileHeaderEnd]}>
        <IconButton
          label={nativeCompact ? "Settings" : "New conversation"}
          icon={nativeCompact ? Menu : SquarePen}
          onPress={
            nativeCompact
              ? () => {
                  onNavigate("settings");
                }
              : onNewConversation
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: colors.canvas },
  compact: { flexDirection: "column" },
  rail: {
    width: 78,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    alignItems: "center",
    paddingTop: 40,
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
  navigation: { gap: 12, marginTop: 64, marginBottom: "auto", paddingTop: 8 },
  body: { flex: 1, minWidth: 0 },
  header: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  mobileHeader: {
    minHeight: 104,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: "flex-start",
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
  chatMenuLabel: { fontSize: 16, color: colors.ink },
  headerEnd: { width: 156, alignItems: "flex-end" },
  mobileHeaderEnd: { width: 44 },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 24,
    backgroundColor: colors.surface,
    boxShadow: "0 3px 12px rgba(0,0,0,0.07)",
  },
  identityAvatar: { width: 28, height: 28, borderRadius: 14 },
  mobileIdentity: {
    flexDirection: "column",
    gap: 0,
    padding: 0,
    backgroundColor: "transparent",
    boxShadow: "none",
  },
  mobileAvatar: { width: 50, height: 50, borderRadius: 25 },
  mobileTitle: {
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    boxShadow: "0 5px 12px rgba(0,0,0,0.06)",
  },
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

import type { ReactNode } from "react";
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
  PanelsTopLeft,
  ChevronDown,
} from "lucide-react-native";
import { IconButton } from "./icon-button";
import { colors } from "./theme";

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
}: {
  readonly children: ReactNode;
  readonly section?: CompanionSection;
  readonly title?: string;
  readonly avatarUri?: string;
  readonly onNavigate: (section: CompanionSection) => void;
  readonly onNewConversation: () => void;
}) {
  const compact = useWindowDimensions().width < 720;
  return (
    <View style={[styles.shell, compact && styles.compact]}>
      {!compact && (
        <View style={styles.rail}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New conversation"
            onPress={onNewConversation}
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
        {section === "chat" && (
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
              {!compact && (
                <Text style={styles.chatMenuLabel}>Conversations</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zoen profile and settings"
              onPress={() => {
                onNavigate("settings");
              }}
              style={styles.identity}
            >
              {avatarUri && (
                <Image
                  source={{ uri: avatarUri }}
                  style={styles.identityAvatar}
                />
              )}
              <Text numberOfLines={1} style={styles.title}>
                Zoen
              </Text>
              <ChevronDown size={16} color={colors.muted} />
            </Pressable>
            <View style={[styles.headerEnd, compact && styles.mobileHeaderEnd]}>
              <IconButton
                label="New conversation"
                icon={SquarePen}
                onPress={onNewConversation}
              />
            </View>
          </View>
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
  mobileHeader: { minHeight: 60, paddingHorizontal: 20, paddingTop: 0 },
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
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 4,
    backgroundColor: colors.canvas,
  },
});

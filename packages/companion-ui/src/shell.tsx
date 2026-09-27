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
  CircleCheck,
  Library,
  Lightbulb,
  MessageCircle,
  Search,
  Settings2,
  SquarePen,
  Waves,
} from "lucide-react-native";
import { IconButton } from "./icon-button";
import { colors } from "./theme";

const sections = [
  { id: "chat", label: "Conversation", icon: MessageCircle },
  { id: "search", label: "Search", icon: Search },
  { id: "feed", label: "Feed", icon: Waves },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
  { id: "goals", label: "Goals", icon: CircleCheck },
  { id: "library", label: "Library", icon: Library },
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
            icon={Settings2}
            selected={section === "settings"}
            onPress={() => {
              onNavigate("settings");
            }}
          />
        </View>
      )}
      <View style={styles.body}>
        <View style={[styles.header, compact && styles.mobileHeader]}>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <IconButton
            label="New conversation"
            icon={SquarePen}
            onPress={onNewConversation}
          />
        </View>
        <View style={styles.content}>{children}</View>
      </View>
      {compact && (
        <View style={styles.bottomBar}>
          {sections
            .filter(({ id }) => id !== "feed" && id !== "search")
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
            icon={Settings2}
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
    paddingTop: 48,
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
  navigation: { gap: 12 },
  body: { flex: 1, minWidth: 0 },
  header: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 32,
    paddingTop: 12,
  },
  mobileHeader: { minHeight: 60, paddingHorizontal: 20, paddingTop: 0 },
  title: { flex: 1, fontSize: 15, fontWeight: "500", color: colors.ink },
  content: { flex: 1, minHeight: 0 },
  bottomBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 8,
    backgroundColor: colors.canvas,
  },
});

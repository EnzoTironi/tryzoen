import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";

export function ConversationNavigation({
  active,
  conversationOpen = false,
  renderConversations,
  children,
  onShowInbox,
  onShowConversation,
}: {
  readonly active: boolean;
  readonly conversationOpen?: boolean;
  readonly onShowInbox?: () => void;
  readonly onShowConversation?: () => void;
  readonly renderConversations?: (actions: {
    close: () => void;
    selected: () => void;
  }) => ReactNode;
  readonly children: (toggle: () => void) => ReactNode;
}) {
  const compact = useWindowDimensions().width < 720;
  const showInbox =
    active && renderConversations && (!compact || !conversationOpen);
  return (
    <View style={styles.navigation}>
      {showInbox && (
        <View
          accessibilityLabel="Lista de conversas"
          style={[styles.sidebar, compact && styles.mobile]}
        >
          {renderConversations({
            close: () => onShowConversation?.(),
            selected: () => onShowConversation?.(),
          })}
        </View>
      )}
      {(!compact || !showInbox) && (
        <View style={styles.content}>{children(() => onShowInbox?.())}</View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  navigation: { flex: 1, flexDirection: "row", minWidth: 0, minHeight: 0 },
  sidebar: {
    width: 308,
    borderRightWidth: 1,
    borderRightColor: "#ededf0",
    minHeight: 0,
  },
  mobile: { width: "100%", borderRightWidth: 0 },
  content: { flex: 1, minWidth: 0 },
});

import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { CompanionOverlay } from "../overlay";
import { colors } from "../theme";
import { ConversationLayout, type ConversationLayoutProps } from "./layout";

export function ConversationNavigation({
  compact,
  active,
  keepConversationsVisible = false,
  renderConversations,
  renderConversationLayout = defaultLayout,
  children,
}: {
  readonly compact: boolean;
  readonly active: boolean;
  readonly keepConversationsVisible?: boolean;
  readonly renderConversations?: (actions: {
    close: () => void;
    selected: () => void;
  }) => ReactNode;
  readonly renderConversationLayout?: (
    props: ConversationLayoutProps
  ) => ReactNode;
  readonly children: (toggle: () => void) => ReactNode;
}) {
  const [shown, setShown] = useState<boolean>();
  const open = active && (shown ?? (!compact && keepConversationsVisible));
  const close = () => {
    setShown(false);
  };
  const panel = open
    ? renderConversations?.({
        close,
        selected: () => {
          if (compact || !keepConversationsVisible) close();
        },
      })
    : null;
  return (
    <>
      {renderConversationLayout({
        children: children(() => {
          setShown(!open);
        }),
        panel: compact ? null : panel,
        open: open && !compact,
      })}
      {open && compact && (
        <CompanionOverlay title="Conversations" onClose={close}>
          <View style={styles.backdrop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss conversations"
              onPress={close}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.sheet}>{panel}</View>
          </View>
        </CompanionOverlay>
      )}
    </>
  );
}
function defaultLayout(props: ConversationLayoutProps) {
  return <ConversationLayout {...props} />;
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(252,252,252,0.55)",
  },
  sheet: {
    height: "85%",
    backgroundColor: colors.canvas,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    padding: 8,
  },
});

import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SheetSurface } from "../sheet";

export function ConversationNavigation({
  active,
  renderConversations,
  children,
}: {
  readonly active: boolean;
  readonly renderConversations?: (actions: {
    close: () => void;
    selected: () => void;
  }) => ReactNode;
  readonly children: (toggle: () => void) => ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const close = () => {
    setShown(false);
  };
  return (
    <>
      <View style={styles.content}>
        {children(() => {
          setShown(!shown);
        })}
      </View>
      {active && shown && (
        <SheetSurface
          title="Conversations"
          onClose={close}
          panelStyle={styles.panel}
          maxWidth={560}
        >
          {renderConversations?.({ close, selected: close })}
        </SheetSurface>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  content: { flex: 1, minWidth: 0 },
  panel: {
    height: "85%",
    maxHeight: 780,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
});

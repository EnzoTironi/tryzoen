import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "../theme";

export interface ConversationLayoutProps {
  readonly children: ReactNode;
  readonly panel: ReactNode;
  readonly open: boolean;
}

export function ConversationLayout({
  children,
  panel,
  open,
}: ConversationLayoutProps) {
  return (
    <View style={styles.layout}>
      <View style={[styles.panel, !open && styles.hidden]}>{panel}</View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}
const styles = StyleSheet.create({
  layout: { flex: 1, minWidth: 0, flexDirection: "row" },
  panel: {
    width: 280,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.line,
  },
  hidden: { display: "none" },
  content: { flex: 1, minWidth: 0 },
});

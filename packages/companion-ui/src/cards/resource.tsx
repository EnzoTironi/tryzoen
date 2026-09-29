import type { ReactNode } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors } from "../theme";

/** One visual grammar for documents, links and connected app activity. */
export function ResourceCard({
  title,
  detail,
  icon: Icon,
  action,
  children,
  tint = colors.accent,
  style,
}: {
  title: string;
  detail?: string;
  icon: LucideIcon;
  action?: ReactNode;
  children?: ReactNode;
  tint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: tint }]}>
          <Icon size={27} color="#fff" strokeWidth={1.6} />
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={2} style={styles.title}>
            {title}
          </Text>
          {!!detail && (
            <Text numberOfLines={2} style={styles.detail}>
              {detail}
            </Text>
          )}
        </View>
        {action}
      </View>
      {children && <View style={styles.content}>{children}</View>}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    width: 340,
    maxWidth: "100%",
    borderRadius: 24,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: colors.wash,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  tile: {
    width: 52,
    height: 60,
    borderRadius: 14,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 3px 8px #00000012",
  },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 16, lineHeight: 21, fontWeight: "600", color: colors.ink },
  detail: { fontSize: 13, lineHeight: 18, color: colors.muted },
  content: { padding: 14, paddingTop: 0, gap: 10 },
});

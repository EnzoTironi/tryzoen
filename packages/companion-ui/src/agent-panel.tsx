import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { List, ShieldCheck, Clock3, Fingerprint, X } from "lucide-react-native";
import { colors } from "./theme";
import { IconButton } from "./icon-button";
import { SheetSurface } from "./sheet";

export type AgentPanelTab = "activity" | "approvals" | "upcoming" | "identity";
const tabs = [
  { id: "activity", label: "Activity", icon: List },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "upcoming", label: "Upcoming", icon: Clock3 },
  { id: "identity", label: "Identity", icon: Fingerprint },
] as const;

export function AgentPanel({
  onClose,
  renderHeader,
  children,
}: {
  readonly onClose: () => void;
  readonly renderHeader?: (onEdit: () => void) => ReactNode;
  readonly children: (tab: AgentPanelTab) => ReactNode;
}) {
  const [tab, setTab] = useState<AgentPanelTab>("activity");
  const compact = useWindowDimensions().width < 720;
  return (
    <SheetSurface
      title="Agent activity and memory"
      onClose={onClose}
      panelStyle={styles.panel}
      maxWidth={560}
      dismissLabel="Close agent panel"
    >
      {!compact && (
        <>
          <View style={styles.close}>
            <IconButton label="Close agent panel" icon={X} onPress={onClose} />
          </View>
          {renderHeader?.(() => {
            setTab("identity");
          })}
        </>
      )}
      <View style={styles.toolbar}>
        <View accessibilityRole="tablist" style={styles.tabs}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: tab === id }}
              onPress={() => {
                setTab(id);
              }}
              style={[styles.tab, tab === id && styles.selected]}
            >
              <Icon
                size={23}
                strokeWidth={1.8}
                color={tab === id ? colors.ink : colors.muted}
              />
            </Pressable>
          ))}
        </View>
        {compact && <IconButton label="Close" icon={X} onPress={onClose} />}
      </View>
      <View style={styles.content}>{children(tab)}</View>
    </SheetSurface>
  );
}
const styles = StyleSheet.create({
  close: { alignItems: "flex-end", paddingHorizontal: 16 },
  panel: { height: "85%", maxHeight: 780 },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16 },
  tabs: {
    flexDirection: "row",
    flex: 1,
    backgroundColor: "#f1f1f2",
    borderRadius: 28,
    padding: 4,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    borderRadius: 24,
  },
  selected: {
    backgroundColor: colors.surface,
    boxShadow: "0 3px 12px rgba(0,0,0,0.09)",
  },
  content: { flex: 1, minHeight: 0 },
});

import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { List, ShieldCheck, Clock3, Fingerprint, X } from "lucide-react-native";
import { colors } from "./theme";
import { IconButton } from "./icon-button";
import { CompanionOverlay } from "./overlay";

export type AgentPanelTab = "activity" | "approvals" | "upcoming" | "identity";
const tabs = [
  { id: "activity", label: "Activity", icon: List },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "upcoming", label: "Upcoming", icon: Clock3 },
  { id: "identity", label: "Identity", icon: Fingerprint },
] as const;

export function AgentPanel({
  onClose,
  children,
}: {
  readonly onClose: () => void;
  readonly children: (tab: AgentPanelTab) => ReactNode;
}) {
  const [tab, setTab] = useState<AgentPanelTab>("activity");
  const compact = useWindowDimensions().width < 720;
  return (
    <CompanionOverlay title="Agent activity and memory" onClose={onClose}>
      <View style={[styles.overlay, compact && styles.compactOverlay]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close agent panel"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[styles.panel, compact && styles.compactPanel]}
        >
          {compact && <View style={styles.handle} />}
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
            <IconButton label="Close" icon={X} onPress={onClose} />
          </View>
          <View style={styles.content}>{children(tab)}</View>
        </View>
      </View>
    </CompanionOverlay>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(252,252,252,0.55)",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: 16,
  },
  compactOverlay: { justifyContent: "flex-end", padding: 0 },
  panel: {
    backgroundColor: colors.canvas,
    width: "100%",
    maxWidth: 480,
    height: "100%",
    borderRadius: 28,
    overflow: "hidden",
    boxShadow: "0 8px 60px rgba(0,0,0,0.12)",
  },
  compactPanel: {
    height: "85%",
    maxWidth: undefined,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  handle: {
    width: 48,
    height: 4,
    backgroundColor: colors.wash,
    borderRadius: 4,
    alignSelf: "center",
    marginTop: 12,
  },
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

import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { List, ShieldCheck, Clock3, Fingerprint, X } from "lucide-react-native";
import { colors } from "./theme";
import { IconButton } from "./icon-button";
import { CompanionOverlay } from "./overlay";
import { DocumentEditing } from "./document-editor";

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
  const requestedCompact = useWindowDimensions().width < 720;
  const [editing, setEditing] = useState(false);
  const [compact, setCompact] = useState(requestedCompact);
  // Reparenting a modal during an edit would discard its unsaved draft.
  if (!editing && compact !== requestedCompact) setCompact(requestedCompact);
  const panel = (
    <View style={[styles.panel, compact && styles.compactPanel]}>
      {compact ? (
        <View style={styles.handle} />
      ) : (
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
    </View>
  );
  return (
    <DocumentEditing value={setEditing}>
      {compact ? (
        <CompanionOverlay title="Agent activity and memory" onClose={onClose}>
          <View style={styles.compactOverlay}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close agent panel"
              onPress={onClose}
              style={StyleSheet.absoluteFill}
            />
            {panel}
          </View>
        </CompanionOverlay>
      ) : (
        panel
      )}
    </DocumentEditing>
  );
}
const styles = StyleSheet.create({
  compactOverlay: {
    flex: 1,
    backgroundColor: "rgba(252,252,252,0.55)",
    justifyContent: "flex-end",
  },
  close: { alignItems: "flex-end", padding: 8 },
  panel: {
    backgroundColor: colors.canvas,
    width: "30%",
    minWidth: 320,
    maxWidth: 480,
    height: "100%",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.line,
    overflow: "hidden",
  },
  compactPanel: {
    width: "100%",
    minWidth: 0,
    maxWidth: undefined,
    height: "85%",
    borderLeftWidth: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    boxShadow: "0 8px 60px rgba(0,0,0,0.12)",
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

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { fileTreeRows } from "./paths";

export function FileTree({
  paths,
  query,
  descending,
  onOpen,
}: {
  readonly paths: readonly string[];
  readonly query: string;
  readonly descending: boolean;
  readonly onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const rows = fileTreeRows(paths, expanded, query, descending);
  return (
    <View>
      <View style={styles.header}>
        <Text style={[styles.column, styles.name]}>Name</Text>
        <Text style={styles.column}>Type</Text>
      </View>
      {rows.map((row) => {
        const open = Boolean(query.trim()) || expanded.has(row.id);
        const Disclosure = open ? ChevronDown : ChevronRight;
        return (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={
              row.folder
                ? `${open ? "Collapse" : "Expand"} folder ${row.title}`
                : row.id
            }
            accessibilityState={row.folder ? { expanded: open } : undefined}
            onPress={() => {
              if (!row.folder) {
                onOpen(row.id);
                return;
              }
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(row.id)) next.delete(row.id);
                else next.add(row.id);
                return next;
              });
            }}
            style={styles.row}
          >
            <View
              style={[
                styles.label,
                { paddingLeft: Math.min(row.depth, 8) * 20 },
              ]}
            >
              <View style={styles.disclosure}>
                {row.folder && <Disclosure size={14} color={colors.muted} />}
              </View>
              {row.folder ? (
                <Folder size={20} color={colors.muted} />
              ) : (
                <FileText size={20} color={colors.muted} />
              )}
              <Text numberOfLines={1} style={styles.title}>
                {row.title}
              </Text>
            </View>
            <Text style={styles.column}>
              {row.folder
                ? "Folder"
                : row.title.split(".").at(-1)?.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
      {rows.length === 0 && (
        <Text style={styles.empty}>
          {query.trim()
            ? "No files match your search."
            : "No system files yet."}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  name: { flex: 1, paddingLeft: 30 },
  column: { color: colors.muted, fontSize: 13, width: 76 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  label: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    paddingRight: 12,
  },
  disclosure: { width: 14 },
  title: { flex: 1, color: colors.ink, fontSize: 15 },
  empty: { color: colors.muted, fontSize: 15, paddingVertical: 24 },
});

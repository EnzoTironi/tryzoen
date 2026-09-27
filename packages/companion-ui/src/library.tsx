import type { ComponentProps } from "react";
import { useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  LayoutGrid,
  List,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  Music,
  Plus,
  Search,
  Shapes,
  Video,
} from "lucide-react-native";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { CompanionPage, pageStyles } from "./page";
import { IconButton } from "./icon-button";
import { colors } from "./theme";
import { FileTree } from "./library/tree";

const categories = [
  {
    label: "All creations",
    icon: Shapes,
    pattern: /^(knowledge|artifacts)\//u,
  },
  {
    label: "Documents",
    icon: FileText,
    pattern: /\.(md|txt|pdf|docx?|rtf|csv|xlsx?|pptx?)$/iu,
  },
  { label: "Web artifacts", icon: Globe, pattern: /\.(html?|jsx?|tsx?)$/iu },
  {
    label: "Images",
    icon: ImageIcon,
    pattern: /\.(png|jpe?g|gif|webp|svg|avif)$/iu,
  },
  { label: "Videos", icon: Video, pattern: /\.(mp4|webm|mov)$/iu },
  { label: "Audio", icon: Music, pattern: /\.(mp3|wav|m4a|ogg)$/iu },
  {
    label: "System files",
    icon: Folder,
    pattern: /^(?!knowledge\/|artifacts\/)/u,
  },
] as const;

export function Library({
  items,
  onOpen,
  onCreate,
  ...state
}: Omit<ComponentProps<typeof CompanionPage>, "title" | "children"> & {
  readonly items: readonly { id: string; title: string; description: string }[];
  readonly onOpen: (id: string) => void;
  readonly onCreate: () => void;
}) {
  const compact = useWindowDimensions().width < 720;
  const [category, setCategory] = useState<(typeof categories)[number]>(
    categories[0]
  );
  const [showCategories, setShowCategories] = useState(false);
  const [query, setQuery] = useState("");
  const [descending, setDescending] = useState(false);
  const [list, setList] = useState(false);
  const systemFiles = category.label === "System files";
  const matching = items
    .filter(
      (item) =>
        (systemFiles || category.pattern.test(item.id)) &&
        item.title.toLowerCase().includes(query.trim().toLowerCase())
    )
    // oxlint-disable-next-line unicorn/no-array-sort -- filter returns a fresh array; retain the shared package’s ES2022 runtime contract.
    .sort((a, b) => (descending ? -1 : 1) * a.title.localeCompare(b.title));
  return (
    <View style={[styles.layout, compact && styles.compact]}>
      {(!compact || showCategories) && (
        <ScrollView style={compact ? styles.mobileCategories : styles.sidebar}>
          <View style={styles.search}>
            <Search size={18} color={colors.muted} />
            <TextInput
              accessibilityLabel="Search library"
              placeholder="Search"
              value={query}
              onChangeText={setQuery}
              style={styles.searchInput}
            />
          </View>
          {categories.map((item, index) => (
            <View key={item.label}>
              {(index === 0 || index === 3) && (
                <Text style={styles.categoryHeading}>
                  {index === 0 ? "Artifacts" : "Media"}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: category.label === item.label }}
                onPress={() => {
                  setCategory(item);
                  setShowCategories(false);
                }}
                style={[
                  styles.category,
                  category.label === item.label && styles.selectedCategory,
                ]}
              >
                <item.icon size={19} color={colors.muted} strokeWidth={1.7} />
                <Text style={styles.categoryLabel}>{item.label}</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      <View style={styles.content}>
        <CompanionPage
          title={category.label}
          actions={
            <View style={styles.actions}>
              {compact && (
                <IconButton
                  icon={ChevronDown}
                  label="Library categories and search"
                  selected={showCategories}
                  onPress={() => {
                    setShowCategories(!showCategories);
                  }}
                />
              )}
              {!systemFiles && (
                <IconButton
                  icon={list ? LayoutGrid : List}
                  label={list ? "Grid view" : "List view"}
                  onPress={() => {
                    setList(!list);
                  }}
                />
              )}
              <IconButton
                icon={descending ? ArrowUpAZ : ArrowDownAZ}
                label={descending ? "Sort files A to Z" : "Sort files Z to A"}
                onPress={() => {
                  setDescending(!descending);
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create a file"
                onPress={onCreate}
                style={styles.create}
              >
                <Plus size={22} color="white" />
              </Pressable>
            </View>
          }
          {...state}
        >
          {systemFiles ? (
            <FileTree
              paths={items.map((item) => item.id)}
              query={query}
              descending={descending}
              onOpen={onOpen}
            />
          ) : (
            <>
              <Text accessibilityRole="header" style={pageStyles.heading}>
                {query ? "Search results" : "Your files"}
              </Text>
              <View style={list ? styles.rows : styles.grid}>
                {matching.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    onPress={() => {
                      onOpen(item.id);
                    }}
                    style={list ? styles.fileRow : styles.card}
                  >
                    {list ? (
                      <FileText size={24} color={colors.muted} />
                    ) : (
                      <View style={styles.preview}>
                        <FileText
                          size={56}
                          strokeWidth={1}
                          color={colors.muted}
                        />
                        <Text numberOfLines={2} style={styles.previewTitle}>
                          {item.title}
                        </Text>
                      </View>
                    )}
                    <View style={list ? styles.rowCaption : styles.caption}>
                      <Text numberOfLines={1} style={pageStyles.rowTitle}>
                        {item.title}
                      </Text>
                      <Text numberOfLines={1} style={pageStyles.copy}>
                        {item.description}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
              {!state.loading && !state.error && matching.length === 0 && (
                <Text style={pageStyles.copy}>
                  {query
                    ? "No files match your search."
                    : `No ${category.label.toLowerCase()} yet. Create something with Zoen to add it here.`}
                </Text>
              )}
            </>
          )}
        </CompanionPage>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  layout: { flex: 1, flexDirection: "row" },
  compact: { flexDirection: "column" },
  sidebar: {
    width: 240,
    flexGrow: 0,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    padding: 12,
  },
  mobileCategories: {
    maxHeight: 300,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  content: { flex: 1, minWidth: 0 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 24,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    paddingVertical: 8,
    outlineWidth: 0,
  },
  categoryHeading: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 10,
  },
  category: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    minHeight: 38,
    borderRadius: 20,
  },
  categoryLabel: { color: colors.ink, fontSize: 14 },
  selectedCategory: { backgroundColor: colors.wash },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  create: {
    width: 36,
    height: 36,
    backgroundColor: colors.accent,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  rows: { gap: 0 },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    minHeight: 76,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowCaption: { flex: 1, gap: 4, paddingVertical: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 20 },
  card: {
    width: 336,
    maxWidth: "100%",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 20,
  },
  preview: {
    height: 190,
    backgroundColor: "#f4f5f7",
    padding: 24,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  previewTitle: {
    color: colors.ink,
    fontSize: 23,
    fontWeight: "500",
    textAlign: "center",
  },
  caption: {
    padding: 18,
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
});

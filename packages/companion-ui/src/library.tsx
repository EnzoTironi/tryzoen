import { useI18n } from "./i18n";
import type { ComponentProps } from "react";
import { useMemo, useState } from "react";
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
  Network,
  Plus,
  Search,
  SearchX,
  Shapes,
  ShieldCheck,
  Braces,
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
import { CompanionPage, usePageStyles } from "./page";
import { IconButton } from "./icon-button";
import {
  radius,
  space,
  systemFont,
  useTypeScale,
  useColors,
  type TypeScale,
} from "./theme";
import { EmptyState } from "./empty-state";
import {
  KnowledgeProposals,
  type KnowledgeProposalData,
} from "./library/knowledge";
import { FileTree } from "./library/tree";
import {
  OntologyCollection,
  type OntologyData,
} from "./library/ontology/collection";

const categories = [
  {
    label: "Review changes",
    icon: ShieldCheck,
    pattern: /^proposals\/knowledge\//u,
  },
  {
    label: "All creations",
    icon: Shapes,
    pattern: /^(knowledge|artifacts)\//u,
  },
  { label: "Knowledge", icon: Network, pattern: /^ontology\//u },
  {
    label: "Documents",
    icon: FileText,
    pattern: /\.(md|txt|pdf|docx?|rtf|csv|xlsx?|pptx?)$/iu,
  },
  { label: "Web artifacts", icon: Globe, pattern: /\.(html?|jsx?|tsx?)$/iu },
  {
    label: "Analysis models",
    icon: Braces,
    pattern: /^knowledge\/models\/.*\.malloy$/u,
  },
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
  proposals,
  ontology,
  ...state
}: Omit<ComponentProps<typeof CompanionPage>, "title" | "children"> & {
  readonly items: readonly { id: string; title: string; description: string }[];
  readonly proposals: KnowledgeProposalData;
  readonly ontology: OntologyData;
  readonly onOpen: (id: string) => void;
  readonly onCreate: (kind: "document" | "model") => void;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const type = useTypeScale();
  const styles = useMemo(() => createStyles(colors, type), [colors, type]);
  const compact = useWindowDimensions().width < 720;
  const [category, setCategory] = useState<(typeof categories)[number]>(
    categories[1]
  );
  const [showCategories, setShowCategories] = useState(false);
  const [query, setQuery] = useState("");
  const [descending, setDescending] = useState(false);
  const [list, setList] = useState(false);
  const reviewing = category.label === "Review changes";
  const knowledge = category.label === "Knowledge";
  const fileControls = !["Review changes", "Knowledge"].includes(
    category.label
  );
  const systemFiles = category.label === "System files";
  // Sorting and layout toggles only earn their place once there is something to arrange.
  const hasItems = !fileControls || items.length > 0;
  return (
    <View style={[styles.layout, compact && styles.compact]}>
      {(!compact || showCategories) && (
        <ScrollView style={compact ? styles.mobileCategories : styles.sidebar}>
          <View style={styles.search}>
            <Search size={18} color={colors.muted} />
            <TextInput
              accessibilityLabel={t("Search library")}
              placeholder={t("Search")}
              value={query}
              onChangeText={setQuery}
              style={styles.searchInput}
            />
          </View>
          {categories.map((item) => (
            <View key={item.label}>
              {(item.label === "All creations" || item.label === "Images") && (
                <Text style={styles.categoryHeading}>
                  {item.label === "All creations" ? t("Artifacts") : t("Media")}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                aria-pressed={category.label === item.label}
                onPress={() => {
                  setCategory(item);
                  setShowCategories(false);
                }}
                style={[
                  styles.category,
                  compact && styles.compactCategory,
                  category.label === item.label && styles.selectedCategory,
                ]}
              >
                <item.icon
                  size={18}
                  color={
                    category.label === item.label ? colors.accent : colors.muted
                  }
                  strokeWidth={1.7}
                />
                <Text
                  style={[
                    styles.categoryLabel,
                    category.label === item.label && styles.selectedLabel,
                  ]}
                >
                  {t(item.label)}
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      <View style={styles.content}>
        <CompanionPage
          title={t(category.label)}
          actions={
            <View style={styles.actions}>
              {compact && (
                <IconButton
                  icon={ChevronDown}
                  label={t("Library categories and search")}
                  selected={showCategories}
                  onPress={() => {
                    setShowCategories(!showCategories);
                  }}
                />
              )}
              {!systemFiles && fileControls && hasItems && (
                <IconButton
                  icon={list ? LayoutGrid : List}
                  label={list ? t("Grid view") : t("List view")}
                  onPress={() => {
                    setList(!list);
                  }}
                />
              )}
              {hasItems && (
                <IconButton
                  icon={descending ? ArrowUpAZ : ArrowDownAZ}
                  label={
                    descending ? t("Sort files A to Z") : t("Sort files Z to A")
                  }
                  onPress={() => {
                    setDescending(!descending);
                  }}
                />
              )}
              {fileControls && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    category.label === "Analysis models"
                      ? t("Create an analysis model")
                      : t("Create a file")
                  }
                  onPress={() => {
                    onCreate(
                      category.label === "Analysis models"
                        ? "model"
                        : "document"
                    );
                  }}
                  hitSlop={4}
                  style={styles.create}
                >
                  <Plus size={22} color="white" />
                </Pressable>
              )}
            </View>
          }
          {...state}
        >
          {knowledge ? (
            <OntologyCollection data={ontology} query={query} />
          ) : reviewing ? (
            <KnowledgeProposals data={proposals} query={query} />
          ) : systemFiles ? (
            <FileTree
              paths={items.map((item) => item.id)}
              query={query}
              descending={descending}
              onOpen={onOpen}
            />
          ) : (
            <LibraryFiles
              items={items}
              descending={descending}
              list={list}
              query={query}
              category={category}
              settled={!state.loading && !state.error}
              onOpen={onOpen}
            />
          )}
        </CompanionPage>
      </View>
    </View>
  );
}
function LibraryFiles({
  items,
  descending,
  list,
  query,
  category,
  settled,
  onOpen,
}: {
  readonly items: ComponentProps<typeof Library>["items"];
  readonly descending: boolean;
  readonly onOpen: ComponentProps<typeof Library>["onOpen"];
  readonly list: boolean;
  readonly query: string;
  readonly category: (typeof categories)[number];
  readonly settled: boolean;
}) {
  const { t, locale } = useI18n();
  const colors = useColors();
  const type = useTypeScale();
  const styles = useMemo(() => createStyles(colors, type), [colors, type]);
  const pageStyles = usePageStyles();
  const matching = items
    .filter(
      (item) =>
        category.pattern.test(item.id) &&
        item.title.toLowerCase().includes(query.trim().toLowerCase())
    )
    // oxlint-disable-next-line unicorn/no-array-sort -- filter returns a fresh array; retain the shared package’s ES2022 runtime contract.
    .sort(
      (a, b) => (descending ? -1 : 1) * a.title.localeCompare(b.title, locale)
    );
  return (
    <>
      {/* An empty state already says where you are; the section label only
          earns its place once there are files under it. */}
      {!(settled && matching.length === 0) && (
        <Text accessibilityRole="header" style={pageStyles.heading}>
          {query ? t("Search results") : t("Your files")}
        </Text>
      )}
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
                <FileText size={56} strokeWidth={1} color={colors.muted} />
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
      {settled && matching.length === 0 && (
        <EmptyState
          icon={query ? SearchX : Shapes}
          title={
            query ? t("No files match your search.") : t("Nothing here yet")
          }
          body={
            query
              ? undefined
              : t("Create something with Zoen and it will show up here.")
          }
        />
      )}
    </>
  );
}
function createStyles(colors: ReturnType<typeof useColors>, type: TypeScale) {
  return StyleSheet.create({
    layout: { flex: 1, flexDirection: "row" },
    compact: { flexDirection: "column" },
    sidebar: {
      width: 248,
      flexGrow: 0,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.line,
      backgroundColor: colors.sidebar,
      paddingHorizontal: space.md,
      paddingTop: space.xl,
      paddingBottom: space.md,
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
      gap: space.sm,
      backgroundColor: colors.wash,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      marginBottom: space.md,
    },
    searchInput: {
      fontFamily: systemFont,
      flex: 1,
      color: colors.ink,
      fontSize: 14,
      paddingVertical: 8,
      outlineWidth: 0,
    },
    categoryHeading: {
      fontFamily: systemFont,
      ...type.eyebrow,
      color: colors.muted,
      marginTop: space.lg,
      marginBottom: space.sm,
      paddingHorizontal: space.sm + 2,
    },
    category: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm + 2,
      paddingHorizontal: space.sm + 2,
      minHeight: 36,
      borderRadius: radius.sm + 2,
    },
    categoryLabel: {
      fontFamily: systemFont,
      ...type.callout,
      fontWeight: "400",
      color: colors.ink,
    },
    // Phone rows meet the 44 pt default touch target.
    compactCategory: { minHeight: 44 },
    selectedCategory: { backgroundColor: colors.accentSoft },
    selectedLabel: { fontWeight: "600" },
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
      backgroundColor: colors.wash,
      padding: 24,
      justifyContent: "center",
      alignItems: "center",
      gap: 16,
    },
    previewTitle: {
      fontFamily: systemFont,
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
}

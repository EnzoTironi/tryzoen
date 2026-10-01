import type { ComponentProps, ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SquareCheck,
  Shapes,
  Lightbulb,
  MessageCircle,
  Search,
  Menu,
  SquarePen,
  ChevronLeft,
  ChevronRight,
  Compass,
  PanelsTopLeft,
  PanelLeft,
  Settings,
  Info,
} from "lucide-react-native";
import { IconButton } from "./icon-button";
import { ConversationChrome } from "./conversation";
import { systemFont, useColors } from "./theme";
import { AgentPanel, type AgentPanelTab } from "./agent-panel";
import { ConversationNavigation } from "./chats/navigation";
import { CompanionVisibility } from "./visibility";
import { CompanionSheet } from "./sheet";

const sections = [
  { id: "chat", label: "Conversas", icon: MessageCircle },
  { id: "search", label: "Buscar", icon: Search },
  { id: "feed", label: "Atividade", icon: PanelsTopLeft },
  { id: "ideas", label: "Ideias", icon: Lightbulb },
  { id: "goals", label: "Objetivos", icon: SquareCheck },
  { id: "library", label: "Biblioteca", icon: Shapes },
  { id: "discover", label: "Agentes", icon: Compass },
  { id: "settings", label: "Ajustes", icon: Settings },
] as const;

export type CompanionSection =
  | "chat"
  | "search"
  | "feed"
  | "ideas"
  | "goals"
  | "library"
  | "settings"
  | "discover";

export function CompanionShell({
  children,
  section = "chat",
  title = "Zoen",
  avatarUri,
  agentName = "Zoen",
  onNavigate,
  onNewConversation,
  renderAgentPanel,
  renderAgentHeader,
  renderConversations,
  conversationOpen = false,
  onShowInbox,
  hideConversationHeader = false,
  contentVisible = true,
}: {
  readonly children: ReactNode;
  readonly conversationOpen?: boolean;
  readonly onShowInbox?: () => void;
  readonly hideConversationHeader?: boolean;
  readonly contentVisible?: boolean;
  readonly section?: CompanionSection;
  readonly title?: string;
  readonly avatarUri?: string;
  readonly agentName?: ReactNode;
  readonly onNavigate: (section: CompanionSection) => void;
  readonly onNewConversation: () => void;
  readonly renderAgentPanel?: (
    tab: AgentPanelTab,
    close: () => void
  ) => ReactNode;
  readonly renderAgentHeader?: (onEdit: () => void) => ReactNode;
} & Pick<
  ComponentProps<typeof ConversationNavigation>,
  "renderConversations"
>) {
  const compact = useWindowDimensions().width < 720;
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [showAgent, setShowAgent] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(compact ? 104 : 80);
  const [expanded, setExpanded] = useState(false);
  const navigate = (next: CompanionSection) => {
    if (next === "chat") onShowInbox?.();
    onNavigate(next);
  };
  const [showMenu, setShowMenu] = useState(false);
  const openMenu = () => {
    setShowMenu(true);
  };
  return (
    <KeyboardAvoidingView
      style={styles.shell}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.layout, compact && styles.mobileLayout]}>
        {!compact && (
          <View
            testID="global-navigation"
            accessibilityLabel="Navegação do Zoen"
            style={[styles.rail, expanded && styles.expandedRail]}
          >
            <View style={styles.railHeader}>
              {expanded && <Text style={styles.brand}>Zoen</Text>}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  expanded ? "Recolher navegação" : "Expandir navegação"
                }
                aria-expanded={expanded}
                onPress={() => {
                  setExpanded((value) => !value);
                }}
                style={styles.railControl}
              >
                <PanelLeft size={21} color={colors.muted} strokeWidth={1.8} />
              </Pressable>
            </View>
            <NavigationItem
              label="Nova conversa com Zoen"
              icon={SquarePen}
              expanded={expanded}
              onPress={onNewConversation}
            />
            <View style={styles.railDivider} />
            <ScrollView
              style={styles.railItems}
              contentContainerStyle={styles.railItemsContent}
            >
              {sections
                .filter(({ id }) => id !== "settings")
                .map(({ id, label, icon }) => (
                  <NavigationItem
                    key={id}
                    label={label}
                    icon={icon}
                    expanded={expanded}
                    selected={id === section}
                    onPress={() => {
                      navigate(id);
                    }}
                  />
                ))}
            </ScrollView>
            <NavigationItem
              label="Ajustes"
              icon={Settings}
              expanded={expanded}
              selected={section === "settings"}
              onPress={() => {
                navigate("settings");
              }}
            />
          </View>
        )}
        <View style={[styles.main, !compact && styles.desktopFrame]}>
          <CompanionVisibility
            value={
              contentVisible && !showMenu && (!showAgent || !renderAgentPanel)
            }
          >
            <ConversationNavigation
              active={section === "chat"}
              renderConversations={renderConversations}
              conversationOpen={conversationOpen}
              onShowInbox={onShowInbox}
            >
              {(toggle) => (
                <View style={styles.body}>
                  {section === "chat" ? (
                    !hideConversationHeader && (
                      <CompanionHeader
                        onLayout={({ nativeEvent }) => {
                          setHeaderHeight(nativeEvent.layout.height);
                        }}
                        compact={compact}
                        title={title}
                        avatarUri={avatarUri}
                        agentName={agentName}
                        canGoBack={Boolean(renderConversations)}
                        onOpenConversations={toggle}
                        onOpenMenu={openMenu}
                        onNewConversation={onNewConversation}
                        onOpenAgent={
                          renderAgentPanel
                            ? () => {
                                setShowAgent(true);
                              }
                            : undefined
                        }
                      />
                    )
                  ) : (
                    <View style={styles.sectionHeader}>
                      <IconButton
                        icon={ChevronLeft}
                        label="Voltar às conversas"
                        onPress={() => {
                          onShowInbox?.();
                          onNavigate("chat");
                        }}
                      />
                      <Text
                        accessibilityRole="header"
                        style={styles.sectionTitle}
                      >
                        {sections.find(({ id }) => id === section)?.label}
                      </Text>
                      <IconButton
                        icon={Menu}
                        label="Menu do Zoen"
                        onPress={openMenu}
                      />
                    </View>
                  )}
                  <ConversationChrome
                    value={{
                      compact,
                      topInset:
                        section === "chat" && !hideConversationHeader
                          ? headerHeight
                          : 0,
                    }}
                  >
                    <View style={styles.content}>{children}</View>
                  </ConversationChrome>
                </View>
              )}
            </ConversationNavigation>
          </CompanionVisibility>
          {compact && !(section === "chat" && conversationOpen) && (
            <View
              testID="mobile-navigation"
              accessibilityLabel="Navegação do Zoen"
              style={styles.bottomNavigation}
            >
              {sections
                .filter(({ id }) =>
                  ["chat", "feed", "library", "discover"].includes(id)
                )
                .map(({ id, label, icon }) => (
                  <NavigationItem
                    key={id}
                    label={label}
                    icon={icon}
                    mobile
                    selected={id === section}
                    onPress={() => {
                      navigate(id);
                    }}
                  />
                ))}
              <NavigationItem
                label="Mais"
                icon={Menu}
                mobile
                selected={
                  !["chat", "feed", "library", "discover"].includes(section)
                }
                onPress={openMenu}
              />
            </View>
          )}
        </View>
      </View>
      {showMenu && (
        <CompanionSheet
          title="Zoen"
          onClose={() => {
            setShowMenu(false);
          }}
        >
          <View style={styles.menu}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setShowMenu(false);
                onNewConversation();
              }}
              style={styles.menuRow}
            >
              <SquarePen size={21} color={colors.accent} />
              <Text style={styles.menuText}>Nova conversa com Zoen</Text>
            </Pressable>
            {sections.map(({ id, label, icon: Icon }) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityState={{ selected: id === section }}
                onPress={() => {
                  setShowMenu(false);
                  navigate(id);
                }}
                style={[styles.menuRow, id === section && styles.selected]}
              >
                <Icon
                  size={21}
                  color={id === section ? colors.accent : colors.ink}
                />
                <Text style={styles.menuText}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </CompanionSheet>
      )}
      {showAgent && renderAgentPanel && (
        <AgentPanel
          renderHeader={renderAgentHeader}
          onClose={() => {
            setShowAgent(false);
          }}
        >
          {(tab) =>
            renderAgentPanel(tab, () => {
              setShowAgent(false);
            })
          }
        </AgentPanel>
      )}
    </KeyboardAvoidingView>
  );
}

function NavigationItem({
  label,
  icon: Icon,
  onPress,
  selected = false,
  expanded = false,
  mobile = false,
}: Pick<
  ComponentProps<typeof IconButton>,
  "label" | "icon" | "onPress" | "selected"
> & {
  readonly expanded?: boolean;
  readonly mobile?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(Platform.OS === "web"
        ? { "aria-current": selected ? ("page" as const) : undefined }
        : { accessibilityState: { selected } })}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navigationItem,
        expanded && styles.expandedItem,
        mobile && styles.mobileNavigationItem,
        selected && styles.navigationSelected,
        pressed && styles.navigationPressed,
      ]}
    >
      <Icon
        size={mobile ? 22 : 21}
        strokeWidth={1.8}
        color={selected ? colors.accent : colors.muted}
      />
      {(expanded || mobile) && (
        <Text
          numberOfLines={1}
          style={[
            styles.navigationLabel,
            mobile && styles.mobileNavigationLabel,
            selected && styles.navigationSelectedLabel,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function CompanionHeader({
  onLayout,
  compact,
  title,
  avatarUri,
  agentName,
  canGoBack,
  onOpenAgent,
  onOpenConversations,
  onOpenMenu,
  onNewConversation,
}: Pick<
  ComponentProps<typeof CompanionShell>,
  "title" | "avatarUri" | "agentName" | "onNewConversation"
> & {
  readonly onLayout: ComponentProps<typeof View>["onLayout"];
  readonly compact: boolean;
  readonly canGoBack: boolean;
  readonly onOpenAgent?: () => void;
  readonly onOpenConversations: () => void;
  readonly onOpenMenu: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View
      testID="conversation-header"
      pointerEvents="box-none"
      onLayout={onLayout}
      accessibilityLabel={title}
      style={[styles.header, compact && styles.mobileHeader]}
    >
      <View pointerEvents="box-none" style={styles.headerSide}>
        <View style={styles.headerControl}>
          {compact && canGoBack ? (
            <IconButton
              icon={ChevronLeft}
              label="Voltar às conversas"
              onPress={onOpenConversations}
            />
          ) : (
            <IconButton
              icon={compact ? Menu : SquarePen}
              label={compact ? "Menu do Zoen" : "Nova conversa com Zoen"}
              onPress={compact ? onOpenMenu : onNewConversation}
            />
          )}
        </View>
      </View>
      <Pressable
        accessibilityRole={onOpenAgent ? "button" : undefined}
        accessibilityLabel={
          onOpenAgent ? "Atividade e memória do Zoen" : undefined
        }
        disabled={!onOpenAgent}
        onPress={onOpenAgent}
        style={styles.identity}
      >
        {avatarUri && (
          <Image
            source={{ uri: avatarUri }}
            style={[styles.identityAvatar, compact && styles.mobileAvatar]}
          />
        )}
        <View style={styles.identityName}>
          <Text
            numberOfLines={1}
            style={[styles.title, compact && styles.mobileTitle]}
          >
            {agentName}
          </Text>
          {onOpenAgent && <ChevronRight size={12} color={colors.muted} />}
        </View>
      </Pressable>
      <View pointerEvents="box-none" style={styles.headerSide}>
        {onOpenAgent && (
          <View style={styles.headerControl}>
            <IconButton
              icon={Info}
              label="Detalhes da conversa"
              onPress={onOpenAgent}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const createStyles = (palette: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    shell: { flex: 1, minHeight: 0, backgroundColor: palette.sidebar },
    layout: { flex: 1, flexDirection: "row", minWidth: 0, minHeight: 0 },
    mobileLayout: { flexDirection: "column" },
    main: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      backgroundColor: palette.canvas,
    },
    desktopFrame: {
      marginVertical: 8,
      marginRight: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      borderRadius: 20,
      overflow: "hidden",
    },
    rail: {
      width: 64,
      paddingHorizontal: 8,
      paddingVertical: 12,
      gap: 4,
      minHeight: 0,
    },
    expandedRail: { width: 200 },
    railHeader: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 4,
    },
    brand: {
      flex: 1,
      marginLeft: 10,
      fontFamily: systemFont,
      fontSize: 18,
      fontWeight: "600",
      color: palette.ink,
    },
    railControl: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
    },
    railDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: palette.line,
      marginHorizontal: 8,
      marginVertical: 8,
    },
    railItems: { flex: 1, minHeight: 0 },
    railItemsContent: { gap: 4 },
    navigationItem: {
      minHeight: 44,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      outlineOffset: 2,
    },
    expandedItem: {
      flexDirection: "row",
      justifyContent: "flex-start",
      paddingHorizontal: 12,
      gap: 12,
    },
    navigationLabel: {
      fontFamily: systemFont,
      fontSize: 14,
      color: palette.ink,
    },
    navigationSelected: { backgroundColor: palette.wash },
    navigationSelectedLabel: { color: palette.ink, fontWeight: "600" },
    navigationPressed: { opacity: 0.65 },
    bottomNavigation: {
      flexDirection: "row",
      alignItems: "center",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.line,
      paddingHorizontal: 4,
      paddingTop: 4,
      paddingBottom: 6,
      backgroundColor: palette.surface,
    },
    mobileNavigationItem: { flex: 1, minHeight: 50, gap: 3, borderRadius: 16 },
    mobileNavigationLabel: { fontSize: 10, color: palette.muted },
    body: { flex: 1, minWidth: 0, minHeight: 0 },
    header: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 30,
      minHeight: 80,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    mobileHeader: {
      minHeight: 104,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    mobileAvatar: { width: 56, height: 56, borderRadius: 28 },
    mobileTitle: { fontSize: 17 },
    headerSide: { width: 44, alignItems: "center" },
    headerControl: {
      borderRadius: 22,
      backgroundColor: `${palette.surface}b8`,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: `${palette.line}70`,
      boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
      ...(Platform.OS === "web"
        ? { backdropFilter: "blur(20px) saturate(180%)" }
        : {}),
    },
    identity: {
      maxWidth: "70%",
      minWidth: 0,
      minHeight: 44,
      alignItems: "center",
      gap: 4,
    },
    identityAvatar: { width: 40, height: 40, borderRadius: 20 },
    identityName: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      maxWidth: "100%",
      minHeight: 24,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: `${palette.line}70`,
      backgroundColor: `${palette.surface}b8`,
      ...(Platform.OS === "web"
        ? { backdropFilter: "blur(20px) saturate(180%)" }
        : {}),
    },
    title: {
      fontFamily: systemFont,
      fontSize: 13,
      fontWeight: "600",
      color: palette.ink,
      flexShrink: 1,
    },
    content: { flex: 1, minHeight: 0 },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 56,
      paddingHorizontal: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.line,
    },
    sectionTitle: {
      flex: 1,
      fontFamily: systemFont,
      fontSize: 17,
      fontWeight: "600",
      textAlign: "center",
      color: palette.ink,
    },
    menu: { gap: 2, backgroundColor: palette.surface },
    menuRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: 48,
      paddingHorizontal: 12,
      borderRadius: 10,
    },
    menuText: { fontFamily: systemFont, fontSize: 17, color: palette.ink },
    selected: { backgroundColor: palette.wash },
  });

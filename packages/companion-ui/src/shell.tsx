import { useI18n } from "./i18n";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
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
import {
  elevation,
  radius,
  space,
  systemFont,
  typeScale,
  useAccessibilityPreferences,
  useColors,
} from "./theme";
import { glassSurface, useGlass, type GlassMode } from "./glass";
import { ShellChrome } from "./shell-chrome";
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
  const { t } = useI18n();
  const compact = useWindowDimensions().width < 720;
  const colors = useColors();
  const glass = useGlass();
  const { reduceMotion } = useAccessibilityPreferences();
  const styles = useMemo(() => createStyles(colors, glass), [colors, glass]);
  const [showAgent, setShowAgent] = useState(false);
  // The floating tab bar minimises to icons while people scroll down and
  // returns as soon as they scroll back up or reach the top.
  const [minimized, setMinimized] = useState(false);
  const lastOffset = useRef(0);
  const reportScroll = useCallback((offset: number) => {
    const delta = offset - lastOffset.current;
    lastOffset.current = offset;
    if (offset < 48) setMinimized(false);
    else if (delta > 6) setMinimized(true);
    else if (delta < -6) setMinimized(false);
  }, []);
  const tabBarVisible = compact && !(section === "chat" && conversationOpen);
  const chrome = useMemo(
    () => ({
      bottomInset: tabBarVisible ? tabBarClearance : 0,
      onScroll: tabBarVisible ? reportScroll : undefined,
    }),
    [tabBarVisible, reportScroll]
  );
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
            accessibilityLabel={t("Navegação do Zoen")}
            style={[styles.rail, expanded && styles.expandedRail]}
          >
            <View style={styles.railHeader}>
              {expanded && <Text style={styles.brand}>{t("Zoen")}</Text>}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  expanded ? t("Recolher navegação") : t("Expandir navegação")
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
              label={t("Nova conversa com Zoen")}
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
                    label={t(label)}
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
              label={t("Ajustes")}
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
            <ShellChrome value={chrome}>
              <ConversationNavigation
                active={section === "chat"}
                renderConversations={renderConversations}
                conversationOpen={conversationOpen}
                onShowInbox={onShowInbox}
              >
                {(toggle) => (
                  <View style={styles.body}>
                    {section === "chat"
                      ? !hideConversationHeader && (
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
                      : null}
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
            </ShellChrome>
          </CompanionVisibility>
          {tabBarVisible && (
            <View
              testID="mobile-navigation"
              accessibilityLabel={t("Navegação do Zoen")}
              style={[
                styles.bottomNavigation,
                minimized && styles.bottomNavigationMinimized,
                !reduceMotion && styles.bottomNavigationMotion,
              ]}
            >
              {sections
                .filter(({ id }) =>
                  ["chat", "feed", "library", "discover"].includes(id)
                )
                .map(({ id, label, icon }) => (
                  <NavigationItem
                    key={id}
                    label={t(label)}
                    icon={icon}
                    mobile
                    minimized={minimized}
                    selected={id === section}
                    onPress={() => {
                      navigate(id);
                    }}
                  />
                ))}
              <NavigationItem
                label={t("Mais")}
                icon={Menu}
                mobile
                minimized={minimized}
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
          title={t("Zoen")}
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
              <Text style={styles.menuText}>{t("Nova conversa com Zoen")}</Text>
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
                <Text style={styles.menuText}>{t(label)}</Text>
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
  minimized = false,
}: Pick<
  ComponentProps<typeof IconButton>,
  "label" | "icon" | "onPress" | "selected"
> & {
  readonly expanded?: boolean;
  readonly mobile?: boolean;
  readonly minimized?: boolean;
}) {
  const colors = useColors();
  const glass = useGlass();
  const styles = useMemo(() => createStyles(colors, glass), [colors, glass]);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onHoverIn={() => {
        setHovered(true);
      }}
      onHoverOut={() => {
        setHovered(false);
      }}
      {...(Platform.OS === "web"
        ? { "aria-current": selected ? ("page" as const) : undefined }
        : { accessibilityState: { selected } })}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navigationItem,
        expanded && styles.expandedItem,
        mobile && styles.mobileNavigationItem,
        mobile && minimized && styles.mobileNavigationItemMinimized,
        hovered && !selected && styles.navigationHovered,
        selected &&
          (mobile ? styles.mobileSelected : styles.navigationSelected),
        pressed && styles.navigationPressed,
      ]}
    >
      <Icon
        size={mobile ? 22 : 20}
        strokeWidth={selected ? 2 : 1.8}
        color={selected ? colors.accent : hovered ? colors.ink : colors.muted}
      />
      {(expanded || (mobile && !minimized)) && (
        <Text
          numberOfLines={1}
          style={[
            styles.navigationLabel,
            mobile && styles.mobileNavigationLabel,
            selected &&
              (mobile
                ? styles.mobileSelectedLabel
                : styles.navigationSelectedLabel),
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
  const { t } = useI18n();
  const colors = useColors();
  const glass = useGlass();
  const styles = useMemo(() => createStyles(colors, glass), [colors, glass]);
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
              label={t("Voltar às conversas")}
              onPress={onOpenConversations}
            />
          ) : (
            <IconButton
              icon={compact ? Menu : SquarePen}
              label={compact ? t("Menu do Zoen") : t("Nova conversa com Zoen")}
              onPress={compact ? onOpenMenu : onNewConversation}
            />
          )}
        </View>
      </View>
      <Pressable
        accessibilityRole={onOpenAgent ? "button" : undefined}
        accessibilityLabel={
          onOpenAgent ? t("Atividade e memória do Zoen") : undefined
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
          {onOpenAgent && <ChevronRight size={12} color={colors.ink} />}
        </View>
      </Pressable>
      <View pointerEvents="box-none" style={styles.headerSide}>
        {onOpenAgent && (
          <View style={styles.headerControl}>
            <IconButton
              icon={Info}
              label={t("Detalhes da conversa")}
              onPress={onOpenAgent}
            />
          </View>
        )}
      </View>
    </View>
  );
}

/** Room the floating tab bar takes, including its gap above the screen edge. */
const tabBarClearance = 96;

const createStyles = (
  palette: ReturnType<typeof useColors>,
  glass: GlassMode & { readonly lens: string }
) =>
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
      marginVertical: space.sm,
      marginRight: space.sm,
      borderRadius: radius.xl,
      overflow: "hidden",
      ...(Platform.OS === "web"
        ? { boxShadow: elevation.raised }
        : {
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.line,
          }),
    },
    // macOS-style floating sidebar: a glass panel inset from the window edge
    // with corners concentric with the content frame beside it.
    rail: {
      width: 64,
      margin: space.sm,
      paddingHorizontal: 9,
      paddingVertical: space.md - 2,
      gap: space.xs,
      minHeight: 0,
      borderRadius: radius.xl,
      ...glassSurface(palette, glass, { elevation: "panel" }),
    },
    expandedRail: { width: 216 },
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
      ...typeScale.headline,
      fontSize: 18,
      letterSpacing: -0.4,
      color: palette.ink,
    },
    railControl: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      outlineOffset: 2,
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
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      outlineOffset: 2,
      ...(Platform.OS === "web"
        ? {
            transitionProperty: "background-color",
            transitionDuration: "140ms",
          }
        : {}),
    },
    expandedItem: {
      flexDirection: "row",
      justifyContent: "flex-start",
      paddingHorizontal: space.md,
      gap: space.md,
    },
    navigationLabel: {
      fontFamily: systemFont,
      ...typeScale.callout,
      fontWeight: "500",
      color: palette.ink,
    },
    navigationHovered: { backgroundColor: palette.wash },
    navigationSelected: { backgroundColor: palette.accentSoft },
    // The selected tab sits in a glass lens: an opaque tint inside the bar
    // that keeps the accent label at 4.6:1 (light) and 4.8:1 (dark).
    mobileSelected: {
      backgroundColor: glass.lens,
      ...(Platform.OS === "web"
        ? {
            boxShadow: glass.dark
              ? "inset 0 1px 0 rgba(255,255,255,0.08)"
              : "inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(16,24,40,0.06)",
          }
        : {}),
    },
    mobileSelectedLabel: { color: palette.accent, fontWeight: "600" },
    navigationSelectedLabel: { color: palette.ink, fontWeight: "600" },
    navigationPressed: { opacity: 0.7 },
    // iOS 26 tab bar: a floating capsule of thick glass, inset from the
    // screen edges and above the home indicator, with content scrolling
    // underneath. Thick glass keeps 10 pt labels legible over any content.
    bottomNavigation: {
      position: "absolute",
      left: space.md,
      right: space.md,
      // Hosts keep the companion inside the safe area (native wraps it, and
      // the web page does not extend under the home indicator), so a fixed
      // inset floats the bar just above the edge.
      bottom: 10,
      zIndex: 40,
      flexDirection: "row",
      alignItems: "center",
      padding: space.xs,
      borderRadius: 32,
      ...glassSurface(palette, glass, {
        thickness: "thick",
        elevation: "floating",
      }),
    },
    bottomNavigationMinimized: {
      left: space.xxxl + space.lg,
      right: space.xxxl + space.lg,
    },
    bottomNavigationMotion: {
      zIndex: 40,
      ...(Platform.OS === "web"
        ? {
            transitionProperty: "left, right",
            transitionDuration: "260ms",
            transitionTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          }
        : {}),
    },
    mobileNavigationItem: {
      flex: 1,
      minHeight: 54,
      gap: 2,
      // Concentric with the bar: its 32 pt radius minus the 4 pt inset.
      borderRadius: 28,
    },
    mobileNavigationItemMinimized: { minHeight: 44, borderRadius: 22 },
    mobileNavigationLabel: {
      fontSize: 10,
      fontWeight: "500",
      color: palette.muted,
    },
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
      ...glassSurface(palette, glass),
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
      ...glassSurface(palette, glass, { elevation: "none" }),
    },
    title: {
      fontFamily: systemFont,
      fontSize: 13,
      fontWeight: "600",
      color: palette.ink,
      flexShrink: 1,
    },
    content: { flex: 1, minHeight: 0 },
    menu: { gap: space.xxs },
    menuRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md + 2,
      minHeight: 50,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
    },
    menuText: {
      fontFamily: systemFont,
      ...typeScale.body,
      fontSize: 16,
      color: palette.ink,
    },
    selected: { backgroundColor: palette.accentSoft },
  });

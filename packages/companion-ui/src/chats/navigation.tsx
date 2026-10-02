import { useI18n } from "./../i18n";
import {
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type FocusEvent,
} from "react-native";
import { CompanionVisibility } from "../visibility";
import { useColors } from "../theme";

export function ConversationNavigation({
  active,
  conversationOpen = false,
  renderConversations,
  children,
  onShowInbox,
  onShowConversation,
}: {
  readonly active: boolean;
  readonly conversationOpen?: boolean;
  readonly onShowInbox?: () => void;
  readonly onShowConversation?: () => void;
  readonly renderConversations?: (actions: {
    close: () => void;
    selected: () => void;
  }) => ReactNode;
  readonly children: (toggle: () => void) => ReactNode;
}) {
  const { t } = useI18n();
  const compact = useWindowDimensions().width < 720;
  const visible = useContext(CompanionVisibility);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const showInbox = Boolean(
    active && renderConversations && (!compact || !conversationOpen)
  );
  const showContent = !compact || !showInbox;
  const inboxFocus = useRef<HTMLElement | null>(null);
  const contentFocus = useRef<HTMLElement | null>(null);
  const shown = useRef({ inbox: showInbox, content: showContent });
  useLayoutEffect(() => {
    if (Platform.OS === "web") {
      const target =
        showContent && !shown.current.content
          ? contentFocus.current
          : showInbox && !shown.current.inbox
            ? inboxFocus.current
            : null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
    shown.current = { inbox: showInbox, content: showContent };
  }, [showInbox, showContent]);
  return (
    <View style={styles.navigation}>
      {renderConversations && (
        <CompanionVisibility value={visible && showInbox}>
          <View
            testID="conversation-sidebar"
            accessibilityLabel={t("Lista de conversas")}
            {...(Platform.OS === "web"
              ? {
                  inert: !showInbox,
                  onFocus: (event: FocusEvent) => {
                    const target: unknown = event.target;
                    if (target instanceof HTMLElement)
                      inboxFocus.current = target;
                  },
                }
              : { "aria-hidden": !showInbox })}
            importantForAccessibility={
              showInbox ? "auto" : "no-hide-descendants"
            }
            pointerEvents={showInbox ? "auto" : "none"}
            style={[
              styles.sidebar,
              compact && styles.mobile,
              !showInbox && styles.hidden,
            ]}
          >
            {renderConversations({
              close: () => onShowConversation?.(),
              selected: () => onShowConversation?.(),
            })}
          </View>
        </CompanionVisibility>
      )}
      <CompanionVisibility value={visible && showContent}>
        <View
          testID="conversation-content"
          {...(Platform.OS === "web"
            ? {
                inert: !showContent,
                onFocus: (event: FocusEvent) => {
                  const target: unknown = event.target;
                  if (target instanceof HTMLElement)
                    contentFocus.current = target;
                },
              }
            : { "aria-hidden": !showContent })}
          importantForAccessibility={
            showContent ? "auto" : "no-hide-descendants"
          }
          pointerEvents={showContent ? "auto" : "none"}
          style={[styles.content, !showContent && styles.hidden]}
        >
          {children(() => onShowInbox?.())}
        </View>
      </CompanionVisibility>
    </View>
  );
}

const createStyles = (palette: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    navigation: { flex: 1, flexDirection: "row", minWidth: 0, minHeight: 0 },
    sidebar: {
      width: 280,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: palette.line,
      overflow: "hidden",
      backgroundColor: palette.sidebar,
      minHeight: 0,
    },
    mobile: { width: "100%", borderRightWidth: 0 },
    content: { flex: 1, minWidth: 0, minHeight: 0 },
    // Web lists keep their measured viewport while inert removes interaction.
    hidden:
      Platform.OS === "web"
        ? {
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            opacity: 0,
            zIndex: -1,
          }
        : { display: "none" },
  });

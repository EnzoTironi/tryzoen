import { MobileI18n, MobileLanguagePicker } from "./i18n";

import { useI18n } from "@zoen/companion-ui/i18n";
import { LocalMessagesProvider } from "@zoen/companion-ui/local-messages";
import { gestureStorage } from "./gesture-storage";
import { mobileMessageStorage } from "./message-storage";
import { MobileOverlayProvider } from "./overlay";
import { useAudioRecording } from "./audio-recording";
import { renderComposerEditor } from "./composer";
import { linkPreviewSchema } from "@zoen/companion-ui/previews";
import { renderMedia } from "./media";
import { referenceResultsSchema } from "@zoen/companion-ui/references";
import { useNetworkState } from "expo-network";
import { onlineManager } from "@tanstack/react-query";
import { rpc } from "./api";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ActionButton,
  CompanionShell,
  GesturePreferenceProvider,
  MarkdownEditorProvider,
  ComposerEditorProvider,
  AttachmentProvider,
  LinkPreviewProvider,
  ComposerReferenceProvider,
  CompanionOverlayProvider,
  useAccessibilityPreferences,
  type CompanionOverlayProps,
  type CompanionSection,
  type MarkdownEditorProps,
} from "@zoen/companion-ui";
import {
  MobileAgentPanel,
  MobileAgentHeader,
  MobileAgentName,
} from "./agent-panel";
import { auth } from "./auth";
import { MobileConversation } from "./conversation";
import { MobileInbox, MobileRoom } from "./inbox";
import { MobileSections } from "./sections";
import { apiOrigin } from "./environment";
import { MobileEditor } from "./editor";
import { pickAttachments, saveAttachment } from "./attachments";
import {
  subscribeAndroidBack,
  subscribeContentLinks,
} from "./navigation/native";
import {
  acceptsMobileStartupLink,
  applyMobileLocation,
  backMobileNavigation,
  initialMobileNavigation,
  mobileLinkDisposition,
  mobileLinkForAccount,
  mobileLinkMessage,
  openMobileConversation,
  parseMobileContentLink,
  reconcileMobileLink,
  type PendingMobileLink,
} from "./navigation/routes";

function renderMarkdownEditor(props: MarkdownEditorProps) {
  return <MobileEditor {...props} />;
}

const composerAdapter = { Input: renderComposerEditor };

const NavigationOverlayContext = createContext<(() => () => void) | undefined>(
  undefined
);
function NavigationOverlay(props: CompanionOverlayProps) {
  const register = useContext(NavigationOverlayContext);
  const compact = useWindowDimensions().width < 720;
  const { reduceMotion } = useAccessibilityPreferences();
  useLayoutEffect(() => register?.(), [register]);
  return (
    <Modal
      accessibilityLabel={props.title}
      transparent
      animationType={reduceMotion ? "none" : compact ? "slide" : "fade"}
      onRequestClose={props.onClose}
      onShow={props.focusOnOpen}
    >
      {props.children}
    </Modal>
  );
}
function renderNavigationOverlay(props: CompanionOverlayProps) {
  return <NavigationOverlay {...props} />;
}

export function App() {
  return (
    <MobileI18n>
      <MobileApp />
    </MobileI18n>
  );
}

function MobileApp() {
  const { t, errorText } = useI18n();
  const network = useNetworkState();
  useEffect(() => {
    onlineManager.setOnline(
      network.isConnected !== false && network.isInternetReachable !== false
    );
  }, [network.isConnected, network.isInternetReachable]);
  const session = auth.useSession();
  const [error, setError] = useState<string>();
  const [signingIn, setSigningIn] = useState(false);
  const [pendingLink, setPendingLink] = useState<PendingMobileLink>();
  const pendingOwner = useRef<string | undefined>(undefined);
  const startupAccount = useRef<string | undefined>(undefined);
  const startupDeparted = useRef(false);
  useLayoutEffect(() => {
    if (session.isPending) return;
    const id = session.data?.session.id;
    if (startupAccount.current === undefined) startupAccount.current = id;
    else if (startupAccount.current !== id) startupDeparted.current = true;
    // Bind before passive work: a canceled effect may not rebind an old locator.
    if (pendingLink && pendingOwner.current === undefined)
      pendingOwner.current = id;
  }, [session.isPending, session.data?.session.id, pendingLink]);
  const receiveLink = useEffectEvent(
    (url: string, source: "initial" | "event") => {
      const id =
        session.data?.session.id ??
        (session.isPending && !startupDeparted.current
          ? startupAccount.current
          : undefined);
      if (
        source === "initial" &&
        !acceptsMobileStartupLink(
          startupAccount.current,
          id,
          startupDeparted.current
        )
      )
        return false;
      const result = parseMobileContentLink(url, apiOrigin);
      if (result.kind === "ignored") return false;
      pendingOwner.current = id;
      setPendingLink({ result, accountSessionId: id });
      return true;
    }
  );
  const linkFailed = useEffectEvent(() => {
    const id =
      session.data?.session.id ??
      (session.isPending && !startupDeparted.current
        ? startupAccount.current
        : undefined);
    if (
      acceptsMobileStartupLink(
        startupAccount.current,
        id,
        startupDeparted.current
      )
    ) {
      pendingOwner.current = id;
      setPendingLink({ result: { kind: "invalid" }, accountSessionId: id });
    }
  });
  useEffect(() => subscribeContentLinks(receiveLink, linkFailed), []);
  const reconcileLink = useEffectEvent(
    (expected: PendingMobileLink, id: string | undefined) => {
      const bound =
        expected.accountSessionId || !pendingOwner.current
          ? expected
          : { ...expected, accountSessionId: pendingOwner.current };
      setPendingLink((current) =>
        current === expected ? reconcileMobileLink(bound, id) : current
      );
    }
  );
  useEffect(() => {
    if (session.isPending || !pendingLink) return undefined;
    let active = true;
    const id = session.data?.session.id;
    queueMicrotask(() => {
      if (active) reconcileLink(pendingLink, id);
    });
    return () => {
      active = false;
    };
  }, [session.isPending, session.data?.session.id, pendingLink]);
  const linkHandled = useCallback((handled: PendingMobileLink) => {
    setPendingLink((current) => (current === handled ? undefined : current));
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        {/* oxlint-disable-next-line react/style-prop-object -- Expo accepts a named status-bar style. */}
        <StatusBar style="dark" />
        {session.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator accessibilityLabel={t("Signing in")} />
          </View>
        ) : session.data ? (
          <AccountCompanion
            key={session.data.session.id}
            sessionId={session.data.session.id}
            pendingLink={
              pendingLink &&
              mobileLinkForAccount(pendingLink, session.data.session.id)
                ? pendingLink
                : undefined
            }
            onLinkHandled={linkHandled}
          />
        ) : (
          <View style={styles.center}>
            <Text style={styles.brand}>{t("Zoen")}</Text>
            <Text style={styles.copy}>
              {t("Your conversations, ideas, and goals. Together.")}
            </Text>
            <MobileLanguagePicker />
            <ActionButton
              disabled={signingIn}
              onPress={() => {
                setSigningIn(true);
                setError(undefined);
                void auth.signIn
                  .social({ provider: "google", callbackURL: "/" })
                  .then((result) => {
                    if (result.error)
                      setError(
                        errorText(
                          result.error.message,
                          "Sign-in failed. Please try again."
                        )
                      );
                  })
                  .catch(() => {
                    setError(
                      t(
                        "Unable to connect. Check your connection and try again."
                      )
                    );
                  })
                  .finally(() => {
                    setSigningIn(false);
                  });
              }}
            >
              {signingIn ? t("Signing in…") : t("Continue with Google")}
            </ActionButton>
            {(error !== undefined || session.error !== null) && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error
                  ? errorText(error)
                  : t("Couldn’t connect to your account. Please try again.")}
              </Text>
            )}
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function AccountCompanion({
  sessionId,
  pendingLink,
  onLinkHandled,
}: {
  readonly sessionId: string;
  readonly pendingLink?: PendingMobileLink;
  readonly onLinkHandled: (link: PendingMobileLink) => void;
}) {
  const { errorText } = useI18n();
  const storage = useMemo(() => mobileMessageStorage(sessionId), [sessionId]);
  const startAudioRecording = useAudioRecording();
  const openOverlays = useRef(0);
  const [overlayVersion, setOverlayVersion] = useState(0);
  const registerOverlay = useCallback(() => {
    openOverlays.current += 1;
    setOverlayVersion((version) => version + 1);
    return () => {
      openOverlays.current -= 1;
      setOverlayVersion((version) => version + 1);
    };
  }, []);
  const hasOpenOverlay = useCallback(() => openOverlays.current > 0, []);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, gcTime: 30 * 60_000, retry: 1 },
        },
      })
  );
  useEffect(
    () => () => {
      client.clear();
    },
    [client]
  );
  const content = (
    <QueryClientProvider client={client}>
      <GesturePreferenceProvider storage={gestureStorage}>
        <LocalMessagesProvider storage={storage}>
          <MobileOverlayProvider>
            <MarkdownEditorProvider value={renderMarkdownEditor}>
              <ComposerEditorProvider value={composerAdapter}>
                <AttachmentProvider
                  pick={pickAttachments}
                  save={saveAttachment}
                  renderMedia={renderMedia}
                  startAudioRecording={startAudioRecording}
                >
                  <MobileCompanion
                    sessionId={sessionId}
                    pendingLink={pendingLink}
                    onLinkHandled={onLinkHandled}
                    hasOpenOverlay={hasOpenOverlay}
                    overlayVersion={overlayVersion}
                    onSignOut={async () => {
                      const result = await auth.signOut();
                      if (result.error)
                        throw new Error(
                          errorText(result.error.message, "Could not sign out.")
                        );
                      client.clear();
                    }}
                  />
                </AttachmentProvider>
              </ComposerEditorProvider>
            </MarkdownEditorProvider>
          </MobileOverlayProvider>
        </LocalMessagesProvider>
      </GesturePreferenceProvider>
    </QueryClientProvider>
  );
  return Platform.OS === "ios" || Platform.OS === "android" ? (
    <NavigationOverlayContext value={registerOverlay}>
      <CompanionOverlayProvider renderOverlay={renderNavigationOverlay}>
        {content}
      </CompanionOverlayProvider>
    </NavigationOverlayContext>
  ) : (
    content
  );
}

function MobileCompanion({
  onSignOut,
  sessionId,
  pendingLink,
  onLinkHandled,
  hasOpenOverlay,
  overlayVersion,
}: {
  readonly onSignOut: () => Promise<void>;
  readonly sessionId: string;
  readonly pendingLink?: PendingMobileLink;
  readonly onLinkHandled: (link: PendingMobileLink) => void;
  readonly hasOpenOverlay: () => boolean;
  readonly overlayVersion: number;
}) {
  const account = auth.useSession();
  const { errorText } = useI18n();
  const [navigation, setNavigation] = useState(initialMobileNavigation);
  const { section, roomId, conversationOpen, conversation } = navigation;
  const [linkError, setLinkError] = useState<string>();
  const consumeLink = useEffectEvent((expected: PendingMobileLink) => {
    if (!pendingLink || expected !== pendingLink) return;
    if (account.isPending || account.data?.session.id !== sessionId) return;
    const disposition = mobileLinkDisposition(
      pendingLink,
      sessionId,
      hasOpenOverlay()
    );
    if (disposition === "defer") return;
    if (disposition === "handle") {
      setLinkError(mobileLinkMessage(pendingLink.result));
      if (pendingLink.result.kind === "location") {
        const location = pendingLink.result.location;
        setNavigation((current) => applyMobileLocation(current, location));
      }
    }
    onLinkHandled(pendingLink);
  });
  useEffect(() => {
    if (
      !pendingLink ||
      account.isPending ||
      account.data?.session.id !== sessionId
    )
      return undefined;
    let active = true;
    queueMicrotask(() => {
      if (active) consumeLink(pendingLink);
    });
    return () => {
      active = false;
    };
  }, [
    pendingLink,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Overlay lifecycle wakes an externally delivered locator after commit.
    overlayVersion,
    account.isPending,
    account.data?.session.id,
    sessionId,
  ]);
  const goBack = useEffectEvent(() => {
    const next = backMobileNavigation(navigation, hasOpenOverlay());
    if (!next) return false;
    setNavigation(next);
    return true;
  });
  useEffect(() => subscribeAndroidBack(goBack), []);
  const setSection = (next: CompanionSection) => {
    setLinkError(undefined);
    setNavigation((current) => ({ ...current, section: next }));
  };
  const setRoomId = (next: string) => {
    setLinkError(undefined);
    setNavigation((current) => ({
      ...current,
      roomId: next,
      conversationOpen: true,
    }));
  };
  const showInbox = () => {
    setNavigation((current) => ({ ...current, conversationOpen: false }));
  };
  const openConversation = (id?: string, draft?: string) => {
    setLinkError(undefined);
    setNavigation((current) => openMobileConversation(current, id, draft));
  };
  return (
    <LinkPreviewProvider
      cacheScope={account.data?.user.id ?? "anonymous"}
      load={async (url) =>
        linkPreviewSchema.parse(
          await rpc.query("workspaces.linkPreview", { url })
        )
      }
    >
      <ComposerReferenceProvider
        cacheScope={account.data?.user.id ?? "anonymous"}
        roomId={roomId}
        search={async (input) =>
          referenceResultsSchema.parse(
            await rpc.query("workspaces.references", input)
          )
        }
      >
        <CompanionShell
          section={section}
          conversationOpen={conversationOpen}
          onShowInbox={() => {
            showInbox();
          }}
          hideConversationHeader={Boolean(roomId)}
          avatarUri={`${apiOrigin}/marketing/zoen-avatar.webp`}
          agentName={<MobileAgentName />}
          renderAgentHeader={(onEdit) => <MobileAgentHeader onEdit={onEdit} />}
          renderAgentPanel={(tab, close) => (
            <MobileAgentPanel
              tab={tab}
              onPrompt={(prompt) => {
                close();
                openConversation(undefined, prompt);
              }}
              onConversation={(id) => {
                close();
                openConversation(id);
              }}
            />
          )}
          renderConversations={() => (
            <MobileInbox
              selectedId={conversation.id}
              selectedRoom={roomId}
              onOpen={openConversation}
              onCreate={() => {
                openConversation();
              }}
              onOpenRoom={(id) => {
                setRoomId(id);
              }}
              onDiscover={() => {
                setSection("discover");
              }}
            />
          )}
          onNavigate={setSection}
          onNewConversation={() => {
            openConversation();
          }}
        >
          {linkError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {errorText(linkError)}
            </Text>
          )}
          {section === "chat" && roomId ? (
            <MobileRoom
              key={roomId}
              roomId={roomId}
              onOpenRoom={setRoomId}
              onBack={() => {
                showInbox();
              }}
            />
          ) : section === "chat" ? (
            <MobileConversation
              key={conversation.key}
              sessionId={conversation.id}
              initialDraft={conversation.draft}
              onCreated={(id, draft) => {
                setNavigation((current) =>
                  current.conversation.key === conversation.key
                    ? {
                        ...current,
                        conversation: { ...current.conversation, id, draft },
                      }
                    : current
                );
              }}
            />
          ) : (
            <MobileSections
              section={section}
              onConversation={(id) => {
                openConversation(id);
              }}
              onPrompt={(draft) => {
                openConversation(undefined, draft);
              }}
              onSignOut={onSignOut}
            />
          )}
        </CompanionShell>
      </ComposerReferenceProvider>
    </LinkPreviewProvider>
  );
}
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#fcfcfc" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 24,
  },
  brand: { fontSize: 44, fontWeight: "600", color: "#111112" },
  copy: { fontSize: 17, color: "#737373", textAlign: "center", lineHeight: 25 },
  error: { color: "#a34437", fontSize: 15, lineHeight: 22 },
});

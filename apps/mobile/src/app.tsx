import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ActionButton,
  CompanionShell,
  MarkdownEditorProvider,
  AttachmentProvider,
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
import { MobileSections } from "./sections";
import { apiOrigin } from "./environment";
import { MobileEditor } from "./editor";
import type { ConversationDraft } from "@zoen/companion-ui/messages";
import { pickAttachments, saveAttachment } from "./attachments";

function renderMarkdownEditor(props: MarkdownEditorProps) {
  return <MobileEditor {...props} />;
}

export function App() {
  const session = auth.useSession();
  const [error, setError] = useState<string>();
  const [signingIn, setSigningIn] = useState(false);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        {/* oxlint-disable-next-line react/style-prop-object -- Expo accepts a named status-bar style. */}
        <StatusBar style="dark" />
        {session.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator accessibilityLabel="Signing in" />
          </View>
        ) : session.data ? (
          <AccountCompanion key={session.data.user.id} />
        ) : (
          <View style={styles.center}>
            <Text style={styles.brand}>Zoen</Text>
            <Text style={styles.copy}>
              Your conversations, ideas, and goals. Together.
            </Text>
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
                        result.error.message ??
                          "Sign-in failed. Please try again."
                      );
                  })
                  .catch(() => {
                    setError(
                      "Unable to connect. Check your connection and try again."
                    );
                  })
                  .finally(() => {
                    setSigningIn(false);
                  });
              }}
            >
              {signingIn ? "Signing in…" : "Continue with Google"}
            </ActionButton>
            {(error !== undefined || session.error !== null) && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error ?? "Couldn’t connect to your account. Please try again."}
              </Text>
            )}
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function AccountCompanion() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <MarkdownEditorProvider value={renderMarkdownEditor}>
        <AttachmentProvider pick={pickAttachments} save={saveAttachment}>
          <MobileCompanion
            onSignOut={async () => {
              const result = await auth.signOut();
              if (result.error)
                throw new Error(result.error.message ?? "Could not sign out.");
              client.clear();
            }}
          />
        </AttachmentProvider>
      </MarkdownEditorProvider>
    </QueryClientProvider>
  );
}

function MobileCompanion({
  onSignOut,
}: {
  readonly onSignOut: () => Promise<void>;
}) {
  const [section, setSection] = useState<CompanionSection>("chat");
  const [conversation, setConversation] = useState<{
    id?: string;
    draft?: ConversationDraft;
    key: number;
  }>({ key: 0 });
  const openConversation = (id?: string, draft?: string) => {
    setConversation((current) => ({
      id,
      draft: draft ? { text: draft, files: [] } : undefined,
      key: current.key + 1,
    }));
    setSection("chat");
  };
  return (
    <CompanionShell
      section={section}
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
      onNavigate={setSection}
      onNewConversation={() => {
        openConversation();
      }}
    >
      {section === "chat" ? (
        <MobileConversation
          key={conversation.key}
          sessionId={conversation.id}
          initialDraft={conversation.draft}
          onCreated={(id, draft) => {
            setConversation((current) => ({ ...current, id, draft }));
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

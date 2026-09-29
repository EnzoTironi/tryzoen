import { MobileVault } from "./vault";
import { useState, type ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import {
  ActionButton,
  CreatorStudio,
  SettingsPanel,
  type SettingsPage,
} from "@zoen/companion-ui";
import { auth } from "../auth";
import { MobileMemory } from "../agent-panel";
import { LinkedChannels } from "./channels";
import { CredentialPermissions } from "./permissions";
import { SignedInSessions } from "./sessions";

export function MobileSettings(props: {
  readonly onClose: () => void;
  readonly onSignOut: () => Promise<void>;
  readonly onPrompt: (text: string) => void;
  readonly creators: ComponentProps<typeof CreatorStudio>["data"];
}) {
  const account = auth.useSession();
  return (
    <SettingsNavigation
      key={account.data?.session.id ?? "signed-out"}
      {...props}
    />
  );
}

function SettingsNavigation({
  onClose,
  onSignOut,
  onPrompt,
  creators,
}: ComponentProps<typeof MobileSettings>) {
  const [page, setPage] = useState<SettingsPage>();
  const signOut = useMutation({ mutationFn: onSignOut });
  return (
    <SettingsPanel
      page={page}
      onSelect={setPage}
      onBack={() => {
        setPage(undefined);
      }}
      onClose={onClose}
      onSignOut={() => {
        signOut.mutate();
      }}
      signingOut={signOut.isPending}
      error={signOut.isError ? "Could not sign out. Try again." : undefined}
    >
      <View key={page} style={styles.content}>
        <SettingsContent
          page={page}
          creators={creators}
          onPrompt={(text) => {
            onClose();
            onPrompt(text);
          }}
        />
      </View>
    </SettingsPanel>
  );
}

function SettingsContent({
  page,
  creators,
  onPrompt,
}: Pick<ComponentProps<typeof MobileSettings>, "creators" | "onPrompt"> & {
  readonly page?: SettingsPage;
}) {
  switch (page) {
    case "general":
      return <GeneralSettings creators={creators} onPrompt={onPrompt} />;
    case "channels":
      return <LinkedChannels />;
    case "permissions":
      return <CredentialPermissions />;
    case "devices":
      return (
        <>
          <Text accessibilityRole="header" style={styles.heading}>
            Signed-in sessions
          </Text>
          <SignedInSessions />
        </>
      );
    case "data":
      return (
        <>
          <Text accessibilityRole="header" style={styles.heading}>
            Personal memory
          </Text>
          <MobileMemory onPrompt={onPrompt} />
        </>
      );
    case "help":
      return (
        <>
          <Text style={styles.description}>
            Ask Zoen how a feature works or describe a problem. Include only the
            details you want to share in the conversation.
          </Text>
          <ActionButton
            onPress={() => {
              onPrompt(
                "I need help using Zoen. Ask me what I am trying to do and what happened."
              );
            }}
          >
            Ask Zoen for help
          </ActionButton>
        </>
      );
    case "legal":
      return (
        <Text style={styles.description}>
          Zoen uses AI and can make mistakes. Review important information and
          requested actions. Connected services have their own terms and privacy
          policies.
        </Text>
      );
    case "connectors":
      return (
        <Text style={styles.description}>
          Connecting and managing provider accounts is not available in this app
          yet. Existing messaging links are managed under Messaging channels.
        </Text>
      );
    case "wallet":
      return <MobileVault kind="payment" />;
    case "vault":
      return <MobileVault kind="login" />;
    default:
      return null;
  }
}

function GeneralSettings({
  creators,
  onPrompt,
}: Pick<ComponentProps<typeof MobileSettings>, "creators" | "onPrompt">) {
  const account = auth.useSession();
  return (
    <>
      <Text accessibilityRole="header" style={styles.heading}>
        {account.data?.user.name ?? "Your account"}
      </Text>
      <Text style={styles.description}>{account.data?.user.email}</Text>
      <ActionButton
        quiet
        onPress={() => {
          onPrompt(
            "Help me create my bot. Interview me about its purpose, expertise, sources and boundaries before creating anything."
          );
        }}
      >
        Create my bot
      </ActionButton>
      <CreatorStudio
        data={creators}
        cacheScope={account.data?.user.id ?? "signed-out"}
      />
      <ActionButton
        quiet
        onPress={() => {
          onPrompt(
            "Help me review my connected tools, available models, and account preferences. Ask what I want to change before applying anything."
          );
        }}
      >
        Discuss preferences with Zoen
      </ActionButton>
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: 20, paddingTop: 8 },
  heading: { fontSize: 20, fontWeight: "600", color: "#171717" },
  description: { fontSize: 15, lineHeight: 22, color: "#686868" },
});

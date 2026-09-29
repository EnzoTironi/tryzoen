import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ActionButton } from "@zoen/companion-ui";
import { auth } from "../auth";

function useSessionList() {
  const account = auth.useSession();
  const userId = account.data?.user.id;
  const currentId = account.data?.session.id;
  const sessions = useQuery({
    queryKey: ["settings", "sessions", userId, currentId],
    enabled: Boolean(userId && currentId),
    queryFn: async () => {
      const result = await auth.listSessions();
      if (result.error)
        throw new Error("Could not load signed-in sessions.", {
          cause: result.error.code,
        });
      return result.data;
    },
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const current = await auth.getSession();
      const target = sessions.data?.find((session) => session.id === id);
      if (
        !userId ||
        current.error ||
        current.data?.user.id !== userId ||
        current.data.session.id !== currentId ||
        id === currentId ||
        !target
      )
        throw new Error("Refresh your signed-in sessions before trying again.");
      const result = await auth.revokeSession({ token: target.token });
      if (result.error)
        throw new Error("Could not sign out this session.", {
          cause: result.error.code,
        });
    },
    onSuccess: async () => {
      await sessions.refetch();
    },
  });
  return { account, currentId, userId, sessions, revoke };
}

export function SignedInSessions() {
  const state = useSessionList();
  return (
    <View style={styles.content}>
      <Text style={styles.description}>
        These are your signed-in apps and browsers. Device control requires
        separate permission.
      </Text>
      <SessionList state={state} />
    </View>
  );
}

function SessionList({
  state,
}: {
  readonly state: ReturnType<typeof useSessionList>;
}) {
  const { account, userId, currentId, sessions, revoke } = state;
  if (account.isPending)
    return <Text accessibilityLiveRegion="polite">Loading your account…</Text>;
  if (!userId || !currentId)
    return (
      <Text accessibilityRole="alert">Sign in to review your sessions.</Text>
    );
  if (
    sessions.error?.cause === "SESSION_NOT_FRESH" ||
    revoke.error?.cause === "SESSION_NOT_FRESH"
  )
    return <SessionReauthentication onRefreshed={() => sessions.refetch()} />;
  if (sessions.isError)
    return (
      <View style={styles.content}>
        <Text accessibilityRole="alert">
          Could not load signed-in sessions. Check your connection and try
          again.
        </Text>
        <ActionButton onPress={() => void sessions.refetch()}>
          Try again
        </ActionButton>
      </View>
    );
  if (sessions.isPending)
    return <Text accessibilityLiveRegion="polite">Loading sessions…</Text>;
  return (
    <>
      {sessions.data.length === 0 && (
        <Text>No signed-in sessions found. Refresh to check again.</Text>
      )}
      {sessions.data.map((session) => (
        <SessionEntry
          key={session.id}
          session={session}
          current={session.id === currentId}
          revoke={revoke}
        />
      ))}
      {revoke.isError && (
        <Text accessibilityRole="alert">
          Could not sign out this session. Refresh and try again.
        </Text>
      )}
      <ActionButton
        quiet
        disabled={sessions.isFetching || revoke.isPending}
        onPress={() => void sessions.refetch()}
      >
        {sessions.isFetching ? "Refreshing…" : "Refresh sessions"}
      </ActionButton>
    </>
  );
}

function SessionReauthentication({
  onRefreshed,
}: {
  readonly onRefreshed: () => Promise<unknown>;
}) {
  const account = auth.useSession();
  const signIn = useMutation({
    mutationFn: async () => {
      const result = await auth.signIn.social({
        provider: "google",
        callbackURL: "/",
        loginHint: account.data?.user.email,
      });
      if (result.error)
        throw new Error("Sign-in could not be completed. Try again.");
      await onRefreshed();
    },
  });
  return (
    <View style={styles.content}>
      <Text accessibilityRole="alert">
        For your security, sign in again to manage your signed-in sessions. Your
        current login stays active if you cancel.
      </Text>
      <ActionButton
        disabled={signIn.isPending}
        onPress={() => {
          signIn.mutate();
        }}
      >
        {signIn.isPending ? "Signing in…" : "Sign in again with Google"}
      </ActionButton>
      {signIn.isError && (
        <Text accessibilityRole="alert">
          Sign-in could not be completed. Try again.
        </Text>
      )}
    </View>
  );
}

function SessionEntry({
  session,
  current,
  revoke,
}: {
  readonly session: NonNullable<
    ReturnType<typeof useSessionList>["sessions"]["data"]
  >[number];
  readonly current: boolean;
  readonly revoke: ReturnType<typeof useSessionList>["revoke"];
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        {current ? "This device" : "App or browser"}
      </Text>
      <Text style={styles.description}>
        {session.userAgent ?? "Unknown device"}
      </Text>
      <Text style={styles.description}>
        Session updated: {new Date(session.updatedAt).toLocaleString()}
      </Text>
      {!current &&
        (confirming ? (
          <>
            <Text>This app or browser will need to sign in again.</Text>
            <ActionButton
              disabled={revoke.isPending}
              onPress={() => {
                revoke.mutate(session.id);
              }}
            >
              {revoke.isPending ? "Signing out…" : "Confirm sign out"}
            </ActionButton>
            <ActionButton
              quiet
              disabled={revoke.isPending}
              onPress={() => {
                setConfirming(false);
                revoke.reset();
              }}
            >
              Cancel
            </ActionButton>
          </>
        ) : (
          <ActionButton
            quiet
            disabled={revoke.isPending}
            onPress={() => {
              revoke.reset();
              setConfirming(true);
            }}
          >
            Sign out this session
          </ActionButton>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  card: { borderRadius: 20, backgroundColor: "#f3f3f3", padding: 18, gap: 12 },
  title: { fontSize: 17, fontWeight: "600", color: "#171717" },
  description: { fontSize: 14, lineHeight: 20, color: "#686868" },
});

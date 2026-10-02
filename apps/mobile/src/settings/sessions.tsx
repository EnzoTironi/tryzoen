import { useI18n, Translated } from "@zoen/companion-ui/i18n";

import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ActionButton } from "@zoen/companion-ui";
import { auth } from "../auth";

function useSessionList() {
  const { t } = useI18n();
  const account = auth.useSession();
  const userId = account.data?.user.id;
  const currentId = account.data?.session.id;
  const sessions = useQuery({
    queryKey: ["settings", "sessions", userId, currentId],
    enabled: Boolean(userId && currentId),
    queryFn: async () => {
      const result = await auth.listSessions();
      if (result.error)
        throw new Error(t("Could not load signed-in sessions."), {
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
        throw new Error(
          t("Refresh your signed-in sessions before trying again.")
        );
      const result = await auth.revokeSession({ token: target.token });
      if (result.error)
        throw new Error(t("Could not sign out this session."), {
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
  const { t } = useI18n();
  const state = useSessionList();
  return (
    <View style={styles.content}>
      <Text style={styles.description}>
        {t(
          "These are your signed-in apps and browsers. Device control requires separate permission."
        )}
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
  const { t } = useI18n();
  const { account, userId, currentId, sessions, revoke } = state;
  if (account.isPending)
    return (
      <Text accessibilityLiveRegion="polite">{t("Loading your account…")}</Text>
    );
  if (!userId || !currentId)
    return (
      <Text accessibilityRole="alert">
        {t("Sign in to review your sessions.")}
      </Text>
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
          {t(
            "Could not load signed-in sessions. Check your connection and try again."
          )}
        </Text>
        <ActionButton onPress={() => void sessions.refetch()}>
          {t("Try again")}
        </ActionButton>
      </View>
    );
  if (sessions.isPending)
    return (
      <Text accessibilityLiveRegion="polite">{t("Loading sessions…")}</Text>
    );
  return (
    <>
      {sessions.data.length === 0 && (
        <Text>{t("No signed-in sessions found. Refresh to check again.")}</Text>
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
          {t("Could not sign out this session. Refresh and try again.")}
        </Text>
      )}
      <ActionButton
        quiet
        disabled={sessions.isFetching || revoke.isPending}
        onPress={() => void sessions.refetch()}
      >
        {sessions.isFetching ? t("Refreshing…") : t("Refresh sessions")}
      </ActionButton>
    </>
  );
}

function SessionReauthentication({
  onRefreshed,
}: {
  readonly onRefreshed: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const account = auth.useSession();
  const signIn = useMutation({
    mutationFn: async () => {
      const result = await auth.signIn.social({
        provider: "google",
        callbackURL: "/",
        loginHint: account.data?.user.email,
      });
      if (result.error)
        throw new Error(t("Sign-in could not be completed. Try again."));
      await onRefreshed();
    },
  });
  return (
    <View style={styles.content}>
      <Text accessibilityRole="alert">
        {t(
          "For your security, sign in again to manage your signed-in sessions. Your current login stays active if you cancel."
        )}
      </Text>
      <ActionButton
        disabled={signIn.isPending}
        onPress={() => {
          signIn.mutate();
        }}
      >
        {signIn.isPending ? t("Signing in…") : t("Sign in again with Google")}
      </ActionButton>
      {signIn.isError && (
        <Text accessibilityRole="alert">
          {t("Sign-in could not be completed. Try again.")}
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
  const { t, locale } = useI18n();
  const [confirming, setConfirming] = useState(false);
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        {current ? t("This device") : t("App or browser")}
      </Text>
      <Text style={styles.description}>
        {session.userAgent ?? t("Unknown device")}
      </Text>
      <Text style={styles.description}>
        <Translated
          message="Session updated: {value1}"
          values={{
            value1: new Date(session.updatedAt).toLocaleString(locale),
          }}
        />
      </Text>
      {!current &&
        (confirming ? (
          <>
            <Text>{t("This app or browser will need to sign in again.")}</Text>
            <ActionButton
              disabled={revoke.isPending}
              onPress={() => {
                revoke.mutate(session.id);
              }}
            >
              {revoke.isPending ? t("Signing out…") : t("Confirm sign out")}
            </ActionButton>
            <ActionButton
              quiet
              disabled={revoke.isPending}
              onPress={() => {
                setConfirming(false);
                revoke.reset();
              }}
            >
              {t("Cancel")}
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
            {t("Sign out this session")}
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

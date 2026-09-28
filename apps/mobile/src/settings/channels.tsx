import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton } from "@zoen/companion-ui";
import {
  linkedChannelIdentitySchema,
  channelUnlinkResultSchema,
} from "../../../../shared/identity/channel-auth";
import { auth } from "../auth";
import { rpc } from "../api";

function useLinkedChannels() {
  const account = auth.useSession();
  const userId = account.data?.user.id;
  const sessionId = account.data?.session.id;
  const client = useQueryClient();
  const [selected, setSelected] = useState<string>();
  const [revoked, setRevoked] = useState(false);
  const channels = useQuery({
    queryKey: ["settings", "linked-channels", userId, sessionId],
    enabled: !!userId && !!sessionId && !account.isPending && !revoked,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) =>
      linkedChannelIdentitySchema
        .array()
        .parse(await rpc.query("accountChannels.list", undefined, { signal })),
  });
  const refetch = channels.refetch;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && userId && sessionId && !revoked) void refetch();
    });
    return () => {
      subscription.remove();
    };
  }, [userId, sessionId, revoked, refetch]);
  const finishSignOut = useMutation({
    mutationFn: async () => {
      const current = await auth.getSession();
      if (current.error)
        throw new Error("Local sign-out could not finish. Try again.");
      if (
        current.data &&
        (current.data.user.id !== userId ||
          current.data.session.id !== sessionId)
      )
        return;
      const result = await auth.signOut();
      if (result.error)
        throw new Error("Local sign-out could not finish. Try again.");
      await account.refetch();
    },
  });
  const unlink = useMutation({
    mutationFn: async (identityId: string) => {
      const current = await auth.getSession();
      if (
        !userId ||
        !sessionId ||
        current.error ||
        current.data?.user.id !== userId ||
        current.data.session.id !== sessionId
      )
        throw new Error("Your session changed. Sign in again.");
      const fresh = linkedChannelIdentitySchema
        .array()
        .parse(await rpc.query("accountChannels.list"));
      if (!fresh.some((identity) => identity.id === identityId))
        throw new Error("This channel is no longer linked.");
      return channelUnlinkResultSchema.parse(
        await rpc.mutation("accountChannels.revoke", { identityId })
      );
    },
    onSuccess: async (result) => {
      setSelected(undefined);
      if (result.status === "last_access") {
        await channels.refetch();
        return;
      }
      setRevoked(true);
      client.clear();
      finishSignOut.mutate();
    },
  });
  const refresh = () => {
    setSelected(undefined);
    unlink.reset();
    void channels.refetch();
  };
  return {
    account,
    userId,
    sessionId,
    channels,
    selected,
    setSelected,
    revoked,
    unlink,
    finishSignOut,
    refresh,
  };
}
export function LinkedChannels() {
  const state = useLinkedChannels();
  return (
    <View style={styles.content}>
      <Text style={styles.description}>
        Review the messengers linked to your account. Unlinking a messenger
        signs you out of all your Zoen apps and browsers.
      </Text>
      <ChannelContent state={state} />
    </View>
  );
}
function ChannelContent({
  state,
}: {
  readonly state: ReturnType<typeof useLinkedChannels>;
}) {
  const {
    account,
    userId,
    sessionId,
    channels,
    selected,
    setSelected,
    revoked,
    unlink,
    finishSignOut,
    refresh,
  } = state;
  if (revoked)
    return (
      <View style={styles.content}>
        <Text accessibilityLiveRegion="polite">
          Messenger unlinked. Your sessions were revoked.
        </Text>
        {finishSignOut.isError ? (
          <>
            <Text accessibilityRole="alert">
              Finish signing out of this app to continue.
            </Text>
            <ActionButton
              onPress={() => {
                finishSignOut.mutate();
              }}
            >
              Finish signing out
            </ActionButton>
          </>
        ) : (
          <Text>Signing out…</Text>
        )}
      </View>
    );
  if (account.isPending) return <Text>Loading your account…</Text>;
  if (!userId || !sessionId)
    return (
      <Text accessibilityRole="alert">
        Sign in to review messaging channels.
      </Text>
    );
  if (account.error || channels.isError || unlink.isError)
    return (
      <View style={styles.content}>
        <Text accessibilityRole="alert">
          Could not verify your linked channels. Refresh and try again.
        </Text>
        <ActionButton onPress={refresh}>Try again</ActionButton>
      </View>
    );
  if (channels.isPending || channels.isFetching)
    return (
      <Text accessibilityLiveRegion="polite">Loading messaging channels…</Text>
    );
  return (
    <>
      {unlink.data?.status === "last_access" && (
        <Text accessibilityRole="alert">
          This is your last linked messenger. It was kept to protect access to
          your account.
        </Text>
      )}
      {channels.data.length === 0 && <Text>No messaging channels linked.</Text>}
      {channels.data.map((identity) => (
        <View key={identity.id} style={styles.row}>
          <Text style={styles.title}>
            {identity.channel === "telegram" ? "Telegram" : "WhatsApp"}
          </Text>
          <Text style={styles.description}>{identity.senderId}</Text>
          <ActionButton
            quiet
            disabled={unlink.isPending}
            onPress={() => {
              setSelected(identity.id);
            }}
          >
            Review unlinking
          </ActionButton>
          {selected === identity.id && (
            <View style={styles.confirmation}>
              <Text>
                Unlink this messenger and sign out of every Zoen session? Your
                conversations are kept.
              </Text>
              <ActionButton
                disabled={unlink.isPending}
                onPress={() => {
                  unlink.mutate(identity.id);
                }}
              >
                {unlink.isPending ? "Unlinking…" : "Unlink and sign out"}
              </ActionButton>
              <ActionButton
                quiet
                disabled={unlink.isPending}
                onPress={() => {
                  setSelected(undefined);
                }}
              >
                Keep linked
              </ActionButton>
            </View>
          )}
        </View>
      ))}
      <ActionButton quiet disabled={unlink.isPending} onPress={refresh}>
        Refresh channels
      </ActionButton>
    </>
  );
}
const styles = StyleSheet.create({
  content: { gap: 16 },
  row: {
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#dedee0",
  },
  title: { fontSize: 18, fontWeight: "600" },
  description: { fontSize: 15, lineHeight: 21, color: "#68696b" },
  confirmation: {
    gap: 12,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "#f2f2f4",
  },
});

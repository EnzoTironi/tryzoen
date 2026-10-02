import { useI18n, Translated } from "@zoen/companion-ui/i18n";

import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton } from "@zoen/companion-ui";
import { credentialPermissionsSchema } from "../../../../shared/vault/permissions";
import { auth } from "../auth";
import { rpc } from "../api";

function useCredentialPermissions() {
  const { t } = useI18n();
  const account = auth.useSession();
  const userId = account.data?.user.id;
  const sessionId = account.data?.session.id;
  const client = useQueryClient();
  const key = ["settings", "credential-permissions", userId, sessionId];
  const [selected, setSelected] = useState<string>();
  const [revoked, setRevoked] = useState(false);
  const grants = useQuery({
    queryKey: key,
    staleTime: 0,
    refetchOnMount: "always",
    enabled: Boolean(userId && sessionId) && !account.isPending,
    queryFn: async ({ signal }) =>
      credentialPermissionsSchema.parse(
        await rpc.query("workspaces.vault.delegations", undefined, { signal })
      ),
  });
  const refetch = grants.refetch;
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active" && userId && sessionId) void refetch();
    });
    return () => {
      listener.remove();
    };
  }, [userId, sessionId, refetch]);
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const current = await auth.getSession();
      if (
        !userId ||
        !sessionId ||
        current.error ||
        current.data?.user.id !== userId ||
        current.data.session.id !== sessionId
      )
        throw new Error(t("Sign in again before changing permissions."));
      const fresh = credentialPermissionsSchema.parse(
        await rpc.query("workspaces.vault.delegations")
      );
      if (!fresh.mayManage || !fresh.items.some((item) => item.id === id))
        throw new Error(
          t("This permission has changed. Refresh before trying again.")
        );
      await rpc.mutation("workspaces.vault.revoke", { id });
      return { id, permissions: fresh };
    },
    onSuccess: async ({ id, permissions }) => {
      setSelected(undefined);
      setRevoked(true);
      client.setQueryData(
        key,
        credentialPermissionsSchema.parse({
          ...permissions,
          items: permissions.items.filter((item) => item.id !== id),
        })
      );
      await grants.refetch();
    },
  });
  const retry = () => {
    setSelected(undefined);
    revoke.reset();
    void grants.refetch();
  };
  return {
    account,
    userId,
    sessionId,
    grants,
    revoke,
    selected,
    setSelected,
    revoked,
    setRevoked,
    retry,
  };
}

export function CredentialPermissions() {
  const { t } = useI18n();
  const state = useCredentialPermissions();
  return (
    <View style={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("Saved credential access")}
      </Text>
      <Text style={styles.description}>
        {t(
          "Review credentials Zoen is allowed to use. Revoking access keeps the saved credential in your vault. These permissions do not control browser actions or device access."
        )}
      </Text>
      <PermissionContent state={state} />
    </View>
  );
}

function PermissionContent({
  state,
}: {
  readonly state: ReturnType<typeof useCredentialPermissions>;
}) {
  const { t, locale } = useI18n();
  const {
    account,
    userId,
    sessionId,
    grants,
    revoke,
    selected,
    setSelected,
    revoked,
    setRevoked,
    retry,
  } = state;
  if (account.isPending) return <Text>{t("Loading your account…")}</Text>;
  if (!userId || !sessionId)
    return (
      <Text accessibilityRole="alert">
        {t("Sign in to review credential permissions.")}
      </Text>
    );
  if (account.error || grants.isError || revoke.isError)
    return (
      <View style={styles.content}>
        <Text accessibilityRole="alert">
          {t(
            "Could not verify credential access. Your account or permissions may have changed. Refresh to try again."
          )}
        </Text>
        <ActionButton onPress={retry}>{t("Try again")}</ActionButton>
      </View>
    );
  if (grants.isPending || grants.isFetching)
    return (
      <Text accessibilityLiveRegion="polite">{t("Loading permissions…")}</Text>
    );
  const items = grants.data.items;
  const selectedGrant = grants.data.mayManage
    ? items.find((item) => item.id === selected)
    : undefined;
  return (
    <>
      {revoked && (
        <Text accessibilityLiveRegion="polite">
          {t("Zoen’s access was revoked. Your saved credential was kept.")}
        </Text>
      )}
      {!grants.data.mayManage && (
        <Text style={styles.description}>
          {t("Only a workspace owner or administrator can revoke access.")}
        </Text>
      )}
      {items.length === 0 && (
        <Text>{t("No active credential permissions.")}</Text>
      )}
      {items.map((item) => (
        <View key={item.id} style={styles.row}>
          <Text style={styles.label}>
            {item.label ??
              t("Saved credential · {value1}", {
                value1: item.itemId.slice(-8),
              })}
          </Text>
          <Text style={styles.description}>
            <Translated
              message="Expires {value1}"
              values={{
                value1: new Date(item.expiresAt).toLocaleString(locale),
              }}
            />
          </Text>
          <ActionButton
            quiet
            disabled={
              !grants.data.mayManage || revoke.isPending || grants.isFetching
            }
            onPress={() => {
              setSelected(item.id);
              setRevoked(false);
            }}
          >
            {t("Revoke Zoen’s access")}
          </ActionButton>
          {selectedGrant?.id === item.id && (
            <View style={styles.confirmation}>
              <Text style={styles.label}>
                <Translated
                  message="Revoke access to {value1}?"
                  values={{
                    value1: selectedGrant.label ?? t("this credential"),
                  }}
                />
              </Text>
              <Text style={styles.description}>
                {t(
                  "Zoen will no longer be able to use this saved credential through this permission."
                )}
              </Text>
              <ActionButton
                disabled={revoke.isPending}
                onPress={() => {
                  revoke.mutate(selectedGrant.id);
                }}
              >
                {revoke.isPending ? t("Revoking…") : t("Confirm revocation")}
              </ActionButton>
              <ActionButton
                quiet
                disabled={revoke.isPending}
                onPress={() => {
                  setSelected(undefined);
                }}
              >
                {t("Keep access")}
              </ActionButton>
            </View>
          )}
        </View>
      ))}
      <ActionButton quiet disabled={revoke.isPending} onPress={retry}>
        {t("Refresh permissions")}
      </ActionButton>
    </>
  );
}
const styles = StyleSheet.create({
  content: { gap: 16 },
  heading: { fontSize: 20, fontWeight: "600" },
  description: { fontSize: 15, lineHeight: 21, color: "#68696b" },
  label: { fontSize: 17, fontWeight: "500" },
  row: {
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#dedee0",
    paddingVertical: 12,
  },
  confirmation: {
    gap: 12,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "#f2f2f4",
  },
});

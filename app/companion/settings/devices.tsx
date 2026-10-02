"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authClient } from "@web/auth/client";
import { Button } from "@web/components/ui/button";
import { useI18n } from "@zoen/companion-ui/i18n";

export function SettingsDevices() {
  const { t, locale, errorText } = useI18n();
  const account = authClient.useSession();
  const sessions = useQuery({
    queryKey: ["settings", "sessions", account.data?.user.id],
    queryFn: async () => {
      const result = await authClient.listSessions();
      if (result.error) throw new Error(errorText(result.error.message));
      return result.data;
    },
  });
  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const result = await authClient.revokeSession({ token });
      if (result.error) throw new Error(errorText(result.error.message));
    },
    onSuccess: async () => {
      await sessions.refetch();
    },
  });
  return (
    <div className="space-y-4">
      <h2 className="type-section-title">{t("Signed-in sessions")}</h2>
      <p className="type-supporting-body text-muted-foreground">
        {t(
          "These are signed-in app and browser sessions. Device control requires separate permission."
        )}
      </p>
      {sessions.isPending && <output>{t("Loading…")}</output>}
      {sessions.error && (
        <div role="alert">
          <p>{t("Could not load sessions.")}</p>
          <Button onClick={() => void sessions.refetch()}>
            {t("Try again")}
          </Button>
        </div>
      )}
      {sessions.data?.map((session) => (
        <section
          className="space-y-2 border-b border-border py-3"
          key={session.id}
        >
          <h3 className="type-card-title">
            {session.id === account.data?.session.id
              ? t("This device")
              : t("App or browser")}
          </h3>
          <p className="type-caption wrap-anywhere text-muted-foreground">
            {session.userAgent ?? t("Unknown device")}
          </p>
          <p className="type-caption text-muted-foreground">
            {t("Last active")}:{" "}
            {new Date(session.updatedAt).toLocaleString(locale)}
          </p>
          {session.id !== account.data?.session.id && (
            <Button
              variant="quiet"
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate(session.token);
              }}
            >
              {t("Sign out this session")}
            </Button>
          )}
        </section>
      ))}
      {revoke.error && (
        <p role="alert">{t("Could not sign out this session. Try again.")}</p>
      )}
    </div>
  );
}

"use client";
import { api } from "@web/trpc/client";
import { Button } from "@web/components/ui/button";
import { useI18n } from "@zoen/companion-ui/i18n";

export function SettingsPermissions() {
  const { t, locale } = useI18n();
  const grants = api.workspaces.vault.delegations.useQuery();
  const revoke = api.workspaces.vault.revoke.useMutation({
    onSuccess: async () => {
      await grants.refetch();
    },
  });
  return (
    <div className="space-y-4">
      <h2 className="type-section-title">{t("Saved credential access")}</h2>
      <p className="type-supporting-body text-muted-foreground">
        {t(
          "Review the access you granted to Zoen. Removing access does not delete the saved credential."
        )}
      </p>
      {grants.isPending && <output>{t("Loading…")}</output>}
      {grants.error && (
        <div role="alert">
          <p>{t("Could not load permissions.")}</p>
          <Button onClick={() => void grants.refetch()}>
            {t("Try again")}
          </Button>
        </div>
      )}
      {grants.data?.items.length === 0 && (
        <p className="type-supporting-body">
          {t("No active credential permissions.")}
        </p>
      )}
      {grants.data?.items.map((item) => (
        <section
          className="space-y-2 border-b border-border py-3"
          key={item.id}
        >
          <p className="type-label">
            {item.label ??
              `${t("Saved credential")} · ${item.itemId.slice(-8)}`}
          </p>
          <p className="type-caption text-muted-foreground">
            {t("Até {date}", {
              date: new Date(item.expiresAt).toLocaleString(locale),
            })}
          </p>
          <Button
            disabled={!grants.data.mayManage || revoke.isPending}
            variant="quiet"
            onClick={() => {
              revoke.mutate({ id: item.id });
            }}
          >
            {t("Revogar acesso do Zoen")}
          </Button>
        </section>
      ))}
      {revoke.error && (
        <p role="alert">
          {t("Não foi possível atualizar o acesso. Tente novamente.")}
        </p>
      )}
    </div>
  );
}

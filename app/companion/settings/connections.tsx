"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { ConnectionList } from "@app/(authenticated)/connections/_components/connection-list";
import { ConnectorLibrary } from "@app/(authenticated)/space/(overview)/_components/connector-library";

export function SettingsConnections({
  channels = false,
}: {
  readonly channels?: boolean;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const google = api.googleWorkspace.read.useQuery();
  const identities = api.accountChannels.list.useQuery();
  const workspace = api.workspaces.files.useQuery({}, { enabled: !channels });
  const refresh = () => {
    void google.refetch();
    void identities.refetch();
  };
  return (
    <div className="space-y-6">
      {google.isPending || identities.isPending ? (
        <output>{t("Loading…")}</output>
      ) : google.error || identities.error ? (
        <div role="alert">
          <p>{t("Não foi possível carregar suas conexões")}</p>
          <Button onClick={refresh}>{t("Try again")}</Button>
        </div>
      ) : (
        <ConnectionList
          kind={channels ? "channels" : "services"}
          googleState={google.data.state}
          identities={identities.data}
          returnTo={`${pathname}?${params}`}
        />
      )}
      {!channels && (
        <ConnectorLibrary
          mayManage={workspace.data?.canEdit ?? false}
          onProposed={async () => {
            await workspace.refetch();
          }}
        />
      )}
    </div>
  );
}

"use client";
import { useI18n } from "@zoen/companion-ui/i18n";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import { CreatorStudio, DiscoverBots } from "@zoen/companion-ui";
import { companionCreatorData } from "@shared/companion/creators";
import { api } from "@web/trpc/client";
import { downloadBlob } from "@web/files/download";
import { authClient } from "@web/auth/client";
import { browserSessionClient } from "@web/eve/client";

export function ConnectedCreatorStudio({
  onPrompt,
}: { readonly onPrompt?: (prompt: string) => void } = {}) {
  const { t } = useI18n();
  const { client } = api.useUtils();
  const session = authClient.useSession();
  const params = useSearchParams();
  const data = useMemo(
    () =>
      companionCreatorData(
        getUntypedClient(client),
        () => crypto.randomUUID(),
        async (content, options) => {
          downloadBlob(
            new Blob([content], { type: options.mediaType }),
            options.filename
          );
        },
        browserSessionClient.sessions
      ),
    [client]
  );
  if (!session.data?.user.id)
    return (
      <output className="type-supporting">
        {session.isPending
          ? t("Loading creator studio…")
          : t("Creator studio unavailable")}
      </output>
    );
  const cacheScope = JSON.stringify([
    session.data.user.id,
    params.get("space") ?? "personal",
  ]);
  if (onPrompt)
    return (
      <DiscoverBots
        key={cacheScope}
        data={data}
        cacheScope={cacheScope}
        onPrompt={onPrompt}
        avatarUri="/marketing/zoen-avatar.webp"
      />
    );
  return <CreatorStudio key={cacheScope} data={data} cacheScope={cacheScope} />;
}

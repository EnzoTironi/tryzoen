"use client";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import { CreatorStudio } from "@zoen/companion-ui";
import { companionCreatorData } from "@shared/companion/creators";
import { api } from "@web/trpc/client";
import { downloadBlob } from "@web/files/download";
import { authClient } from "@web/auth/client";

export function ConnectedCreatorStudio() {
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
        }
      ),
    [client]
  );
  if (!session.data?.user.id)
    return (
      <output className="type-supporting">
        {session.isPending
          ? "Loading creator studio…"
          : "Creator studio unavailable"}
      </output>
    );
  const cacheScope = JSON.stringify([
    session.data.user.id,
    params.get("space") ?? "personal",
  ]);
  return <CreatorStudio key={cacheScope} data={data} cacheScope={cacheScope} />;
}

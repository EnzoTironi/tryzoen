"use client";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { getUntypedClient } from "@trpc/client";
import { CreatorStudio } from "@zoen/companion-ui";
import { companionCreatorData } from "@shared/companion/creators";
import { api } from "@web/trpc/client";
import { authClient } from "@web/auth/client";

export function ConnectedCreatorStudio() {
  const { client } = api.useUtils();
  const session = authClient.useSession();
  const params = useSearchParams();
  const data = useMemo(
    () =>
      companionCreatorData(getUntypedClient(client), () => crypto.randomUUID()),
    [client]
  );
  const cacheScope = JSON.stringify([
    session.data?.user.id,
    params.get("space") ?? "personal",
  ]);
  return <CreatorStudio key={cacheScope} data={data} cacheScope={cacheScope} />;
}

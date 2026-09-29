"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppRouter } from "./router";
import { useSearchParams } from "next/navigation";

import { authClient } from "@web/auth/client";
import { LocalMessagesProvider } from "@zoen/companion-ui/local-messages";
import { browserMessageStorage } from "./message-storage";

export const api = createTRPCReact<AppRouter>();

export function TRPCProvider({ children }: { readonly children: ReactNode }) {
  const account = authClient.useSession();
  const workspaceId = useSearchParams().get("space");
  if (account.isPending) return null;
  return (
    <WorkspaceTRPCProvider
      key={`${account.data?.session.id ?? "anonymous"}:${workspaceId ?? "personal"}`}
      sessionId={account.data?.session.id}
      workspaceId={workspaceId}
    >
      {children}
    </WorkspaceTRPCProvider>
  );
}

function WorkspaceTRPCProvider({
  children,
  workspaceId,
  sessionId,
}: {
  readonly children: ReactNode;
  readonly workspaceId: string | null;
  readonly sessionId?: string;
}) {
  const storage = useMemo(
    () => (sessionId ? browserMessageStorage(sessionId) : undefined),
    [sessionId]
  );
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, gcTime: 30 * 60_000 } },
      })
  );
  useEffect(
    () => () => {
      queryClient.clear();
    },
    [queryClient]
  );
  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          headers: workspaceId ? { "x-zoen-workspace": workspaceId } : {},
        }),
      ],
    })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {storage ? (
          <LocalMessagesProvider storage={storage}>
            {children}
          </LocalMessagesProvider>
        ) : (
          children
        )}
      </api.Provider>
    </QueryClientProvider>
  );
}

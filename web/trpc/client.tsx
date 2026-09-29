"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useEffect, useState, type ReactNode } from "react";
import type { AppRouter } from "./router";
import { useSearchParams } from "next/navigation";

export const api = createTRPCReact<AppRouter>();

export function TRPCProvider({ children }: { readonly children: ReactNode }) {
  const workspaceId = useSearchParams().get("space");
  return (
    <WorkspaceTRPCProvider
      key={workspaceId ?? "personal"}
      workspaceId={workspaceId}
    >
      {children}
    </WorkspaceTRPCProvider>
  );
}

function WorkspaceTRPCProvider({
  children,
  workspaceId,
}: {
  readonly children: ReactNode;
  readonly workspaceId: string | null;
}) {
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
        {children}
      </api.Provider>
    </QueryClientProvider>
  );
}

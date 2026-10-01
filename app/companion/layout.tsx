import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { requireRequestScope } from "@web/auth/request-scope";
import { TRPCProvider } from "@web/trpc/client";

/** Keep the workspace cache above conversation routes; never share it across accounts. */
export default async function CompanionLayout({
  children,
}: {
  children: ReactNode;
}) {
  const scope = await requireRequestScope().catch((cause: unknown) => {
    if (cause instanceof WorkspaceAccessDenied) notFound();
    throw cause;
  });
  return <TRPCProvider key={scope.userId}>{children}</TRPCProvider>;
}

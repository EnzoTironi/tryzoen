import type { ReactNode } from "react";
import { requireRequestScope } from "@web/auth/request-scope";
import { TRPCProvider } from "@web/trpc/client";

/** Keep the workspace cache above conversation routes; never share it across accounts. */
export default async function CompanionLayout({
  children,
}: {
  children: ReactNode;
}) {
  const scope = await requireRequestScope();
  return <TRPCProvider key={scope.userId}>{children}</TRPCProvider>;
}

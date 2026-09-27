"use client";

import dynamic from "next/dynamic";
import { TRPCProvider } from "@web/trpc/client";

const ConnectedCompanion = dynamic(
  () => import("./connected").then((module) => module.ConnectedCompanion),
  {
    ssr: false,
    loading: () => <output style={{ padding: 32 }}>Opening Zoen…</output>,
  }
);

export function CompanionClient(props: {
  readonly sessionId?: string;
  readonly title?: string;
}) {
  return (
    <TRPCProvider>
      <ConnectedCompanion {...props} />
    </TRPCProvider>
  );
}

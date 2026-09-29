"use client";

import dynamic from "next/dynamic";

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
  readonly draftScope: string;
}) {
  return <ConnectedCompanion {...props} />;
}

import { notFound } from "next/navigation";
import { readChat } from "@db/services/chats";
import { isSessionOwned } from "@db/services/sessions";
import { requireRequestScope } from "@web/auth/request-scope";
import { CompanionClient } from "../client";

export default async function CompanionPage({
  params,
}: PageProps<"/companion/[[...session]]">) {
  const scope = await requireRequestScope();
  const { session: segments } = await params;
  if (segments && segments.length !== 1) notFound();
  const sessionId = segments?.[0];
  if (sessionId && !(await isSessionOwned(scope, sessionId))) notFound();
  const chat = sessionId ? await readChat(scope, sessionId) : undefined;
  return (
    <CompanionClient
      key={`${scope.workspaceId}:${scope.userId}:${sessionId ?? "new"}`}
      draftScope={JSON.stringify([scope.workspaceId, scope.userId])}
      sessionId={sessionId}
      title={chat?.title}
    />
  );
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireRequestScope } from "@web/auth/request-scope";
import { CompanionClient } from "../companion/client";
import { resolveWorkspaceActor } from "../../server/workspaces/session";
import { WorkspaceRepository } from "../../server/workspaces/repository";

export default async function CompanionHome() {
  const scope = await requireRequestScope();
  const actor = await resolveWorkspaceActor(await headers());
  const identity = await WorkspaceRepository.selection(actor, [
    "agent/IDENTITY.md",
  ]);
  if (!identity.documents.length) redirect("/onboarding");
  return (
    <CompanionClient
      draftScope={JSON.stringify([scope.workspaceId, scope.userId])}
    />
  );
}

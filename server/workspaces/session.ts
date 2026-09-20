import { readAuthSession } from "@db/services/auth/session";
import { ensureScope } from "@db/services/scope";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { requireWorkspaceAccess, WorkspaceAccessDenied } from "./access";

export const resolveWorkspaceActor = async function (headers: Headers) {
  const session = await readAuthSession(headers);
  if (!session) throw new WorkspaceAccessDenied();
  const personal = accessScopeForUser(`better-auth:${session.user.id}`);
  await Promise.try(async () => ensureScope(personal)).catch(() => {
    throw new WorkspaceAccessDenied();
  });
  return await requireWorkspaceAccess({
    userId: personal.userId,
    workspaceId: headers.get("x-zoen-workspace") ?? personal.workspaceId,
    authSessionId: session.session.id,
  });
};

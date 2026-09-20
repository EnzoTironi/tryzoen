import { readAuthSession } from "@db/services/auth/session";
import { readUserProfile, replaceUserProfile } from "@db/services/user-profile";
import { accessScopeForUser } from "@shared/identity/access-scope";
import type { UserProfile } from "@shared/user-profile/schema";
import { PersonalMemoryError, requirePersonalMemoryWebSession } from "./access";

const profileSession = async function (headers: Headers) {
  const session = await readAuthSession(headers);
  if (!session) throw new PersonalMemoryError({ reason: "unauthenticated" });
  return {
    scope: accessScopeForUser(`better-auth:${session.user.id}`),
    id: session.session.id,
  };
};

export const readPersonalProfile = async function (headers: Headers) {
  const session = await profileSession(headers);
  return await readUserProfile(() =>
    requirePersonalMemoryWebSession(session.scope, session.id)
  );
};

export const replacePersonalProfile = async function (
  headers: Headers,
  input: UserProfile
) {
  const session = await profileSession(headers);
  return await replaceUserProfile(
    () => requirePersonalMemoryWebSession(session.scope, session.id),
    input
  );
};

import { AuthUnavailable } from "../../db/services/auth/index";
import { readAuthSession } from "@db/services/auth/session";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { PersonalMemory } from "./index";
import { PersonalMemoryError, requirePersonalMemoryWebSession } from "./access";

export const inspectPersonalMemory = async function (headers: Headers) {
  try {
    const scope = await requirePersonalMemorySession(headers);
    const memory = PersonalMemory;
    const snapshot = await memory.inspect(scope);
    // Better Auth may cache a session. The access operation also checks its live SQL row.
    await requirePersonalMemorySession(headers);
    return snapshot;
  } catch (error) {
    if (error instanceof AuthUnavailable) {
      throw new PersonalMemoryError({ reason: "unavailable" });
    }
    throw error;
  }
};

export const exportPersonalMemory = async function (headers: Headers) {
  const snapshot = await inspectPersonalMemory(headers);
  return new Response(JSON.stringify(snapshot, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition":
        'attachment; filename="companion-personal-memory.json"',
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
};

const requirePersonalMemorySession = async function (headers: Headers) {
  const session = await readAuthSession(headers);
  if (!session) throw new PersonalMemoryError({ reason: "unauthenticated" });
  return await requirePersonalMemoryWebSession(
    accessScopeForUser(`better-auth:${session.user.id}`),
    session.session.id
  );
};

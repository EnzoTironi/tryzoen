import { getAuth, AuthUnavailable } from "@db/services/auth";

export const readAuthSession = async function (headers: Headers) {
  const auth = await getAuth();
  try {
    return await auth.api.getSession({ headers });
  } catch {
    throw new AuthUnavailable();
  }
};

export function getAuthSession(headers: Headers) {
  return readAuthSession(headers);
}

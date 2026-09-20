import { BrowserWorkerAccessError } from "../../../../server/browser-worker/access";
import type { SessionAuthContext } from "eve/context";
import { BrowserWorkerAccess } from "../../../../server/browser-worker";
const denialMessage = {
  lease_inactive: "The scheduled run lease is no longer active.",
  paused: "The scheduled job is no longer active.",
  revoked: "The caller's channel authority has been revoked.",
  unauthenticated: "The caller no longer has live authority.",
  unavailable: "Live authority could not be verified.",
} as const;
export async function assertLiveWorkerAuthority(principal: SessionAuthContext) {
  await Promise.try(async () => {
    const access = BrowserWorkerAccess;
    return await access.authorize(principal);
  }).catch((error: unknown) => {
    if (error instanceof BrowserWorkerAccessError)
      throw new Error(denialMessage[error.reason]);
    throw error;
  });
}

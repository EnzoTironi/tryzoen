import type { MediaAccessPermissionRequest } from "electron";
import { isApplicationNavigation } from "./navigation.js";

/** Only main-frame audio from the configured app may ask the person for access. */
export function isMicrophoneRequest(
  details: MediaAccessPermissionRequest,
  origin: string
) {
  return (
    details.isMainFrame &&
    details.mediaTypes?.length === 1 &&
    details.mediaTypes[0] === "audio" &&
    isApplicationNavigation(details.requestingUrl, origin) &&
    (details.securityOrigin === undefined ||
      isApplicationNavigation(details.securityOrigin, origin))
  );
}

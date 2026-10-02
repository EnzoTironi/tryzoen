import { dialog, systemPreferences, type BrowserWindow } from "electron";
import { isMicrophoneRequest } from "./audio-permission.js";
import { isApplicationNavigation } from "./navigation.js";
import { desktopText as t } from "./i18n.js";

/** Each capture requires app-origin validation and explicit native consent. */
export function registerAudioAccess(window: BrowserWindow, origin: string) {
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      if (
        contents !== window.webContents ||
        permission !== "media" ||
        !isMicrophoneRequest(details, origin)
      ) {
        callback(false);
        return;
      }
      const deny = () => {
        callback(false);
      };
      void dialog
        .showMessageBox(window, {
          type: "question",
          message: t("Allow Zoen to record this voice message?"),
          detail: t("Recording stays local until you attach it and tap Send."),
          buttons: [t("Cancel"), t("Allow microphone")],
          defaultId: 0,
          cancelId: 0,
        })
        .then(async ({ response }) => {
          const allowed =
            response === 1 &&
            (process.platform !== "darwin" ||
              (await systemPreferences.askForMediaAccess("microphone")));
          return (
            allowed &&
            !contents.isDestroyed() &&
            isApplicationNavigation(contents.getURL(), origin)
          );
        })
        // oxlint-disable-next-line promise/no-callback-in-promise -- Electron requires its permission callback after the asynchronous native prompt.
        .then(callback, deny);
    }
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
}
